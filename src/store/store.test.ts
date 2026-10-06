import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APPENDIX_A } from '../lib/__fixtures__/appendix-a';
import { DEFAULT_SETTINGS } from '../lib/doc';
import { makeBackup, parseBackup, serializeBackup } from '../lib/io/backup';
import { connectStore, useApp, writeRescue } from './app';
import { classifyDbError, createRepo, openDb, type SvoimiDB } from './db';

const initial = useApp.getState();
let dbName = '';
let db: SvoimiDB;

class MemoryStorage {
  data = new Map<string, string>();
  getItem = (k: string) => this.data.get(k) ?? null;
  setItem = (k: string, v: string) => void this.data.set(k, v);
  removeItem = (k: string) => void this.data.delete(k);
}

/** Имитация перезагрузки страницы: новое соединение с той же базой и чистый стор. */
async function reload() {
  db.close();
  db = openDb(dbName);
  useApp.setState({ ...initial }, true);
  connectStore(createRepo(db), { delayMs: 50 });
  await useApp.getState().hydrate();
}

beforeEach(async () => {
  dbName = `test-${Math.random()}`;
  db = openDb(dbName);
  vi.stubGlobal('localStorage', new MemoryStorage());
  useApp.setState({ ...initial }, true);
  connectStore(createRepo(db), { delayMs: 50 });
  await useApp.getState().hydrate();
});

afterEach(async () => {
  db.close();
  await db.delete();
  vi.unstubAllGlobals();
});

describe('документ переживает перезагрузку', () => {
  it('созданный и отредактированный документ возвращается с тем же текстом и позицией', async () => {
    const s = useApp.getState();
    const doc = s.createDocument(APPENDIX_A);
    s.go('session');
    s.updateDoc(doc.id, (d) => ({
      ...d,
      currentIndex: 1,
      blocks: d.blocks.map((b, i) => (i === 0 ? { ...b, status: 'done', userText: 'Мой пересказ первого блока.' } : i === 1 ? { ...b, status: 'writing', userText: 'Начало второго' } : b)),
    }));
    await useApp.getState().flush();

    await reload();
    const after = useApp.getState();
    expect(after.screen).toBe('session');
    expect(after.currentDocId).toBe(doc.id);
    const d = after.docs[0]!;
    expect(d.currentIndex).toBe(1);
    expect(d.blocks[0]!.userText).toBe('Мой пересказ первого блока.');
    expect(d.blocks[1]).toMatchObject({ status: 'writing', userText: 'Начало второго' });
  });

  it('автосохранение срабатывает само по debounce, без flush', async () => {
    const doc = useApp.getState().createDocument('Короткий текст для проверки автосохранения без явного вызова.');
    useApp.getState().updateDoc(doc.id, (d) => ({ ...d, title: 'Новое имя' }));
    await new Promise((r) => setTimeout(r, 150));
    expect((await db.docs.get(doc.id))?.title).toBe('Новое имя');
  });

  it('настройки и тема сохраняются', async () => {
    useApp.getState().setSettings({ theme: 'light', pressure: 'soft', allowPaste: true });
    await new Promise((r) => setTimeout(r, 20));
    await reload();
    expect(useApp.getState().settings).toEqual({ ...DEFAULT_SETTINGS, theme: 'light', pressure: 'soft', allowPaste: true });
  });

  it('переименование и удаление документа сохраняются', async () => {
    const s = useApp.getState();
    const a = s.createDocument('Первый документ для проверки удаления из списка.');
    const b = s.createDocument('Второй документ для проверки переименования в списке.');
    s.renameDoc(b.id, '  Письмо инвестору ');
    await useApp.getState().deleteDoc(a.id);
    await useApp.getState().flush();
    await reload();
    expect(useApp.getState().docs.map((d) => [d.id, d.title])).toEqual([[b.id, 'Письмо инвестору']]);
  });

  it('список документов отсортирован по дате изменения, свежие сверху', async () => {
    const s = useApp.getState();
    const a = s.createDocument('Старый документ, который потом изменится последним.');
    await new Promise((r) => setTimeout(r, 5));
    s.createDocument('Новый документ, созданный вторым по счёту.');
    await new Promise((r) => setTimeout(r, 5));
    s.updateDoc(a.id, (d) => ({ ...d, currentIndex: 0 }));
    expect(useApp.getState().docs[0]!.id).toBe(a.id);
  });
});

describe('закрытие вкладки', () => {
  it('несохранённая правка попадает в аварийный снимок и восстанавливается при запуске', async () => {
    const doc = useApp.getState().createDocument(APPENDIX_A);
    await useApp.getState().flush();
    // Правка, которую debounce ещё не успел записать, и вкладка закрывается.
    useApp.getState().updateDoc(doc.id, (d) => ({ ...d, blocks: d.blocks.map((b, i) => (i === 0 ? { ...b, userText: 'Последние буквы' } : b)) }));
    writeRescue();
    expect(localStorage.getItem('svoimi:rescue')).toContain('Последние буквы');

    // Вкладка закрылась до записи: reload() выбрасывает старый автосейвер с его таймером,
    // так что в базе осталась прежняя версия, а свежая есть только в снимке.
    expect((await db.docs.get(doc.id))!.blocks[0]!.userText).toBe('');
    await reload();
    expect(useApp.getState().docs[0]!.blocks[0]!.userText).toBe('Последние буквы');
    expect((await db.docs.get(doc.id))!.blocks[0]!.userText).toBe('Последние буквы');
    expect(localStorage.getItem('svoimi:rescue')).toBeNull();
  });

  it('устаревший снимок не затирает более свежую версию из базы', async () => {
    const doc = useApp.getState().createDocument(APPENDIX_A);
    await useApp.getState().flush();
    localStorage.setItem('svoimi:rescue', JSON.stringify([{ ...useApp.getState().docs[0]!, title: 'Старое', updatedAt: 1 }]));
    await reload();
    expect(useApp.getState().docs.find((d) => d.id === doc.id)!.title).not.toBe('Старое');
  });
});

describe('аварийный снимок при закрытии вкладки', () => {
  const stored = () => JSON.parse(localStorage.getItem('svoimi:rescue') ?? '[]') as Array<{ id: string }>;

  it('в снимок попадает только документ с несохранёнными правками, а не вся база', async () => {
    const s = useApp.getState();
    const a = s.createDocument('Первый документ для проверки снимка.');
    s.createDocument('Второй документ для проверки снимка.');
    s.createDocument('Третий документ для проверки снимка.');
    await useApp.getState().flush();
    expect(await db.docs.count()).toBe(3);

    useApp.getState().updateDoc(a.id, (d) => ({ ...d, title: 'Правка' }));
    writeRescue();
    expect(stored().map((d) => d.id)).toEqual([a.id]);
  });

  it('когда всё сохранено, снимок не пишется', async () => {
    useApp.getState().createDocument('Документ без несохранённых правок.');
    await useApp.getState().flush();
    writeRescue();
    expect(localStorage.getItem('svoimi:rescue')).toBeNull();
  });

  it('документ, который записывается прямо сейчас, тоже попадает в снимок', async () => {
    const doc = useApp.getState().createDocument('Документ, который уйдёт в запись при закрытии вкладки.');
    let release!: () => void;
    vi.spyOn(db.docs, 'bulkPut').mockImplementationOnce(() => new Promise<string>((r) => (release = () => r('')))  as never);
    const flushing = useApp.getState().flush(); // запись началась, но не завершилась
    await new Promise((r) => setTimeout(r, 0));
    writeRescue();
    expect(stored().map((d) => d.id)).toEqual([doc.id]);
    release();
    await flushing;
  });

  it('переполненный localStorage не ломает закрытие вкладки', () => {
    const doc = useApp.getState().createDocument('Документ для проверки переполнения localStorage.');
    const quota = () => {
      throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    };
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: quota, removeItem: () => {} });
    expect(() => writeRescue()).not.toThrow();
    expect(useApp.getState().docs[0]!.id).toBe(doc.id);
  });

  it('недоступный localStorage (SecurityError при обращении) тоже не ломает закрытие', () => {
    useApp.getState().createDocument('Документ для проверки недоступного localStorage.');
    vi.stubGlobal(
      'localStorage',
      new Proxy({}, {
        get() {
          throw Object.assign(new Error('denied'), { name: 'SecurityError' });
        },
      }),
    );
    expect(() => writeRescue()).not.toThrow();
  });
});

describe('ошибки IndexedDB', () => {
  it('ошибка записи показывается, данные остаются в памяти, после успешной повторной записи ошибка снимается', async () => {
    const doc = useApp.getState().createDocument(APPENDIX_A);
    await useApp.getState().flush();
    const quota = Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    const spy = vi.spyOn(db.docs, 'bulkPut').mockRejectedValueOnce(quota);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    useApp.getState().updateDoc(doc.id, (d) => ({ ...d, title: 'После ошибки' }));
    await useApp.getState().flush();
    expect(useApp.getState().saveError).toBe('quota');
    expect(useApp.getState().docs[0]!.title).toBe('После ошибки');

    await useApp.getState().flush(); // повторная попытка (в приложении её запускает таймер)
    expect(spy).toHaveBeenCalledTimes(2);
    expect(useApp.getState().saveError).toBeNull();
    expect((await db.docs.get(doc.id))!.title).toBe('После ошибки');
  });

  it('если IndexedDB недоступна, приложение стартует в памяти с понятной ошибкой', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const repo = createRepo(db);
    vi.spyOn(repo, 'loadDocs').mockRejectedValue(Object.assign(new Error('no idb'), { name: 'MissingAPIError' }));
    useApp.setState({ ...initial }, true);
    connectStore(repo);
    await useApp.getState().hydrate();
    expect(useApp.getState()).toMatchObject({ ready: true, saveError: 'unavailable', docs: [] });
  });

  it('classifyDbError разбирает вложенные ошибки Dexie', () => {
    expect(classifyDbError({ name: 'AbortError', inner: { name: 'QuotaExceededError' } })).toBe('quota');
    expect(classifyDbError({ name: 'OpenFailedError' })).toBe('unavailable');
    expect(classifyDbError(new Error('x'))).toBe('unknown');
  });
});

describe('резервная копия через стор', () => {
  it('загрузка копии не меняет текущие настройки', async () => {
    useApp.getState().setSettings({ theme: 'light', pressure: 'soft' });
    const other = { ...DEFAULT_SETTINGS, theme: 'sepia' as const, pressure: 'kamikaze' as const, allowPaste: true };
    const json = serializeBackup(makeBackup([], other));
    const parsed = parseBackup(json);
    if (!parsed.ok) throw new Error('копия не разобралась');
    expect(parsed.settings).toEqual(other); // формат файла хранит настройки
    useApp.getState().createDocument('Документ из копии для проверки настроек.');
    await useApp.getState().importDocs(useApp.getState().docs);
    expect(useApp.getState().settings).toMatchObject({ theme: 'light', pressure: 'soft', allowPaste: false });
  });

  it('выгрузка, очистка базы и загрузка обратно восстанавливают документы', async () => {
    const s = useApp.getState();
    s.createDocument(APPENDIX_A);
    s.createDocument('Второй документ для резервной копии.');
    await useApp.getState().flush();
    const json = serializeBackup(makeBackup(useApp.getState().docs, useApp.getState().settings));
    const before = useApp.getState().docs;

    await db.docs.clear();
    await reload();
    expect(useApp.getState().docs).toEqual([]);

    const parsed = parseBackup(json);
    if (!parsed.ok) throw new Error('копия не разобралась');
    await useApp.getState().importDocs(parsed.documents);
    await reload();
    expect(useApp.getState().docs).toEqual(before);
  });
});

describe('вкладка отдала документы другой (lock)', () => {
  it('дописывает очередь и больше ничего не пишет: устаревшая версия не затирает новый текст', async () => {
    const s = useApp.getState();
    const doc = s.createDocument(APPENDIX_A);
    s.updateDoc(doc.id, (d) => ({ ...d, title: 'до блокировки' }));
    await useApp.getState().lock();
    expect(useApp.getState().locked).toBe(true);
    expect((await db.docs.get(doc.id))?.title).toBe('до блокировки');

    // Другая вкладка пишет новый текст.
    await db.docs.put({ ...(await db.docs.get(doc.id))!, title: 'из другой вкладки', updatedAt: Date.now() + 1000 });
    // Старая вкладка: учёт времени, переименование, удаление, настройки — ничего не доходит до базы.
    s.updateDoc(doc.id, (d) => ({ ...d, title: 'устаревшая' }));
    s.renameDoc(doc.id, 'устаревшая');
    await s.deleteDoc(doc.id);
    s.setSettings({ pressure: 'kamikaze' });
    await useApp.getState().flush();
    await new Promise((r) => setTimeout(r, 120));
    expect((await db.docs.get(doc.id))?.title).toBe('из другой вкладки');
    expect((await db.settings.get('settings'))?.value).toBeUndefined();
  });
});

describe('ошибки записи не теряют текст', () => {
  const quota = () => Object.assign(new Error('full'), { name: 'QuotaExceededError' });

  it('при запуске запись восстановленного из снимка падает: документы видны, снимок не стирается', async () => {
    const doc = useApp.getState().createDocument(APPENDIX_A);
    await useApp.getState().flush();
    useApp.getState().updateDoc(doc.id, (d) => ({ ...d, title: 'Из снимка' }));
    writeRescue();

    db.close();
    db = openDb(dbName);
    const spy = vi.spyOn(db.docs, 'bulkPut').mockRejectedValue(quota());
    useApp.setState({ ...initial }, true);
    connectStore(createRepo(db), { delayMs: 50 });
    await useApp.getState().hydrate();

    expect(useApp.getState().docs.map((d) => d.title)).toEqual(['Из снимка']);
    expect(useApp.getState().saveError).toBe('quota');
    expect(localStorage.getItem('svoimi:rescue')).toContain('Из снимка');
    // Новая правка другого документа и закрытие вкладки: снимок не теряет восстановленное.
    useApp.getState().createDocument('Второй документ для проверки снимка.');
    writeRescue();
    expect(localStorage.getItem('svoimi:rescue')).toContain('Из снимка');

    spy.mockRestore();
    await useApp.getState().flush();
    expect((await db.docs.get(doc.id))?.title).toBe('Из снимка');
    expect(localStorage.getItem('svoimi:rescue')).toBeNull();
  });

  it('повреждённый снимок не опустошает список документов', async () => {
    useApp.getState().createDocument(APPENDIX_A);
    await useApp.getState().flush();
    localStorage.setItem('svoimi:rescue', '{"not":"array"}');
    await reload();
    expect(useApp.getState().docs).toHaveLength(1);
    expect(useApp.getState().saveError).toBeNull();
  });

  it('импорт копии при ошибке записи остаётся в очереди и в аварийном снимке', async () => {
    const doc = useApp.getState().createDocument(APPENDIX_A);
    await useApp.getState().flush();
    const copy = { ...doc, id: 'imported', title: 'Из копии' };
    const spy = vi.spyOn(db.docs, 'bulkPut').mockRejectedValueOnce(quota());
    await useApp.getState().importDocs([copy]);
    expect(useApp.getState().saveError).toBe('quota');
    writeRescue();
    expect(localStorage.getItem('svoimi:rescue')).toContain('Из копии');
    spy.mockRestore();
    await new Promise((r) => setTimeout(r, 2100));
    expect((await db.docs.get('imported'))?.title).toBe('Из копии');
  });

  it('удалённый во время неудачной записи документ не возвращается повтором', async () => {
    const doc = useApp.getState().createDocument(APPENDIX_A);
    let reject!: (e: Error) => void;
    const spy = vi.spyOn(db.docs, 'bulkPut').mockImplementationOnce(() => new Promise((_, r) => (reject = r)) as never);
    const flushing = useApp.getState().flush();
    await new Promise((r) => setTimeout(r, 5));
    await useApp.getState().deleteDoc(doc.id);
    writeRescue();
    expect(localStorage.getItem('svoimi:rescue')).toBeNull();
    reject(quota());
    await flushing;
    spy.mockRestore();
    await new Promise((r) => setTimeout(r, 2100));
    expect(await db.docs.get(doc.id)).toBeUndefined();
  });

  it('restartDocument: копия открывается в сессии, старый документ остаётся', async () => {
    const st = useApp.getState();
    const doc = st.createDocument(APPENDIX_A, { title: 'Текст' });
    st.updateDoc(doc.id, (d) => ({ ...d, blocks: d.blocks.map((b) => ({ ...b, status: 'done' as const, userText: 'мой' })) }));
    const copy = useApp.getState().restartDocument(doc.id, '(ещё раз)')!;
    const s = useApp.getState();
    expect(copy.title).toBe('Текст (ещё раз)');
    expect([s.screen, s.currentDocId]).toEqual(['session', copy.id]);
    expect(s.docs).toHaveLength(2);
    expect(s.docs.find((d) => d.id === doc.id)!.blocks.every((b) => b.status === 'done')).toBe(true);
    expect(s.docs.find((d) => d.id === copy.id)!.blocks.every((b) => b.status === 'pending' && b.userText === '')).toBe(true);
    await s.flush();
    await reload();
    expect(useApp.getState().docs).toHaveLength(2);
  });

  it('hintsIntroSeen хранится в настройках и переживает перезагрузку', async () => {
    expect(useApp.getState().settings.hintsIntroSeen).toBe(false);
    useApp.getState().setSettings({ hintsIntroSeen: true });
    await new Promise((r) => setTimeout(r, 100));
    await reload();
    expect(useApp.getState().settings.hintsIntroSeen).toBe(true);
  });
});
