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
    await useApp.getState().importDocs(parsed.documents, parsed.settings);
    await reload();
    expect(useApp.getState().docs).toEqual(before);
  });
});
