import { describe, expect, it } from 'vitest';
import { APPENDIX_A } from './__fixtures__/appendix-a';
import { DEFAULT_SETTINGS, cloneForRetry, createDoc, doneCount, isFinished, normalizeSettings, screenForDoc, titleFromFileName, titleFromSource } from './doc';

const seqId = () => {
  let n = 0;
  return () => `id${++n}`;
};

describe('createDoc', () => {
  it('создаёт документ с блоками, ключевыми фразами и пустыми счётчиками', () => {
    const doc = createDoc(APPENDIX_A, { now: 1000, newId: seqId() });
    expect(doc).toMatchObject({ id: 'id1', blockSize: 'medium', manualEdits: false, currentIndex: 0, createdAt: 1000, updatedAt: 1000 });
    expect(doc.blocks).toHaveLength(3);
    expect(new Set(doc.blocks.map((b) => b.id)).size).toBe(3);
    for (const b of doc.blocks) {
      expect(b.status).toBe('pending');
      expect(b.userText).toBe('');
      expect(b.keyphrases.length).toBeGreaterThanOrEqual(3);
      expect(b.hints).toEqual({ maxLevel: 0, opens: { 1: 0, 2: 0, 3: 0 }, peeks: 0, peekMs: 0 });
    }
  });

  it('учитывает размер блоков и название из опций', () => {
    const doc = createDoc(APPENDIX_A, { blockSize: 'short', title: '  Pomodoro  ' });
    expect(doc.blocks.length).toBeGreaterThan(3);
    expect(doc.title).toBe('Pomodoro');
  });

  it('название по умолчанию: первые 6 слов', () => {
    expect(titleFromSource(APPENDIX_A)).toBe('В современном мире умение эффективно управлять');
    expect(titleFromSource('## Заголовок документа\nтекст')).toBe('Заголовок документа');
    expect(titleFromSource('   ')).toBe('');
    expect(titleFromFileName('Письмо инвестору.docx')).toBe('Письмо инвестору');
  });

  it('doneCount считает завершённые блоки', () => {
    const doc = createDoc(APPENDIX_A);
    doc.blocks[0]!.status = 'done';
    doc.blocks[1]!.status = 'writing';
    expect(doneCount(doc)).toBe(1);
  });
});

describe('cloneForRetry', () => {
  const worked = () => {
    const doc = createDoc(APPENDIX_A, { now: 1000, newId: seqId() });
    doc.manualEdits = true;
    doc.finishedAt = 5000;
    doc.currentIndex = 2;
    for (const b of doc.blocks) {
      b.userText = 'мой пересказ';
      b.status = 'done';
      b.hints = { maxLevel: 3, opens: { 1: 2, 2: 1, 3: 1 }, peeks: 4, peekMs: 900 };
      b.typedChars = 12;
      b.pastedChars = 3;
      b.activeMs = 7000;
    }
    return doc;
  };

  it('сохраняет исходник, блоки, ключевые фразы и ручные правки', () => {
    const doc = worked();
    const copy = cloneForRetry(doc, 'Название (ещё раз)', { now: 9000, newId: seqId() });
    expect(copy.source).toBe(doc.source);
    expect(copy.title).toBe('Название (ещё раз)');
    expect(copy.blockSize).toBe(doc.blockSize);
    expect(copy.manualEdits).toBe(true);
    expect(copy.blocks.map((b) => b.sourceText)).toEqual(doc.blocks.map((b) => b.sourceText));
    expect(copy.blocks.map((b) => b.keyphrases)).toEqual(doc.blocks.map((b) => b.keyphrases));
    expect(copy.blocks.map((b) => [b.kind, b.paragraphIndex])).toEqual(doc.blocks.map((b) => [b.kind, b.paragraphIndex]));
  });

  it('сбрасывает текст, статусы, подсказки и счётчики', () => {
    const copy = cloneForRetry(worked(), 'x', { now: 9000, newId: seqId() });
    expect(copy).toMatchObject({ currentIndex: 0, createdAt: 9000, updatedAt: 9000 });
    expect(copy.finishedAt).toBeUndefined();
    for (const b of copy.blocks) {
      expect(b).toMatchObject({ userText: '', status: 'pending', typedChars: 0, pastedChars: 0, activeMs: 0 });
      expect(b.hints).toEqual({ maxLevel: 0, opens: { 1: 0, 2: 0, 3: 0 }, peeks: 0, peekMs: 0 });
    }
    expect(screenForDoc(copy)).toBe('split');
  });

  it('выдаёт новые id и не трогает оригинал', () => {
    const doc = worked();
    const before = JSON.stringify(doc);
    const copy = cloneForRetry(doc, 'x');
    expect(copy.id).not.toBe(doc.id);
    const ids = new Set(doc.blocks.map((b) => b.id));
    for (const b of copy.blocks) expect(ids.has(b.id)).toBe(false);
    expect(new Set(copy.blocks.map((b) => b.id)).size).toBe(copy.blocks.length);
    expect(JSON.stringify(doc)).toBe(before);
    copy.blocks[0]!.keyphrases[0]!.start += 1;
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe('normalizeSettings', () => {
  it('пустое значение даёт настройки по умолчанию, вставка выключена', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.allowPaste).toBe(false);
    expect(DEFAULT_SETTINGS.pressureDelaySec).toBe(7);
  });

  it('битые поля заменяются значениями по умолчанию, задержка ограничивается', () => {
    expect(normalizeSettings({ theme: 'neon', pressure: 'soft', pressureDelaySec: 99, allowPaste: 'yes', writingFont: 'mono' })).toEqual({
      ...DEFAULT_SETTINGS,
      pressure: 'soft',
      pressureDelaySec: 30,
      writingFont: 'mono',
    });
  });
});

describe('screenForDoc', () => {
  it('новый документ ведёт в разбивку, начатый в сессию, готовый в итог', () => {
    const doc = createDoc(APPENDIX_A);
    expect(screenForDoc(doc)).toBe('split');
    doc.blocks[0]!.status = 'writing';
    expect(screenForDoc(doc)).toBe('session');
    doc.blocks.forEach((b) => (b.status = 'done'));
    expect(isFinished(doc)).toBe(true);
    expect(screenForDoc(doc)).toBe('result');
  });

  it('документ с finishedAt считается готовым', () => {
    expect(isFinished({ ...createDoc(APPENDIX_A), finishedAt: 5 })).toBe(true);
  });
});
