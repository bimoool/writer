import { describe, expect, it } from 'vitest';
import { APPENDIX_A } from '../__fixtures__/appendix-a';
import { DEFAULT_SETTINGS, createDoc } from '../doc';
import { backupFileName, makeBackup, parseBackup, planImport, resolveImport, serializeBackup } from './backup';

const docA = createDoc(APPENDIX_A, { now: 1 });
const docB = createDoc('Второй документ. Тут немного текста для проверки копии.', { now: 2 });

describe('резервная копия (SPEC §10)', () => {
  it('формат { app, version, exportedAt, documents, settings }', () => {
    const b = makeBackup([docA], DEFAULT_SETTINGS, 123);
    expect(Object.keys(b).sort()).toEqual(['app', 'documents', 'exportedAt', 'settings', 'version']);
    expect(b).toMatchObject({ app: 'svoimi', version: 1, exportedAt: 123 });
  });

  it('выгрузка и загрузка обратно дают те же документы и настройки', () => {
    const settings = { ...DEFAULT_SETTINGS, theme: 'sepia' as const, pressure: 'kamikaze' as const };
    const parsed = parseBackup(serializeBackup(makeBackup([docA, docB], settings)));
    expect(parsed).toEqual({ ok: true, documents: [docA, docB], settings, skipped: 0 });
  });

  it('не JSON, чужой файл и другая версия различаются', () => {
    expect(parseBackup('{oops')).toEqual({ ok: false, error: 'json' });
    expect(parseBackup('{"hello":1}')).toEqual({ ok: false, error: 'format' });
    expect(parseBackup(JSON.stringify({ app: 'svoimi', version: 2, documents: [] }))).toEqual({ ok: false, error: 'version' });
  });

  it('битые документы пропускаются, остальные загружаются', () => {
    const broken = { ...docB, blocks: [{ id: 'x' }] };
    const json = JSON.stringify({ ...makeBackup([docA], DEFAULT_SETTINGS), documents: [docA, broken, 42] });
    const parsed = parseBackup(json);
    expect(parsed.ok && parsed.documents.map((d) => d.id)).toEqual([docA.id]);
    expect(parsed.ok && parsed.skipped).toBe(2);
  });

  it('отсутствующие или битые настройки заменяются значениями по умолчанию', () => {
    const json = JSON.stringify({ app: 'svoimi', version: 1, exportedAt: 0, documents: [], settings: { theme: 42 } });
    const parsed = parseBackup(json);
    expect(parsed.ok && parsed.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('совпадающие id попадают в конфликты, решение «заменить» или «пропустить» по каждому', () => {
    const docC = createDoc('Третий документ, совсем новый для этой базы.');
    const plan = planImport([docA.id, docB.id], [docA, docB, docC, docC]);
    expect(plan.fresh.map((d) => d.id)).toEqual([docC.id]);
    expect(plan.conflicts.map((d) => d.id)).toEqual([docA.id, docB.id]);
    const toWrite = resolveImport(plan, (d) => (d.id === docA.id ? 'replace' : 'skip'));
    expect(toWrite.map((d) => d.id)).toEqual([docC.id, docA.id]);
  });

  it('имя файла копии с датой', () => {
    expect(backupFileName(new Date(2026, 9, 3).getTime())).toBe('svoimi-backup-2026-10-03.json');
  });
});
