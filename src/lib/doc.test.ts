import { describe, expect, it } from 'vitest';
import { APPENDIX_A } from './__fixtures__/appendix-a';
import { DEFAULT_SETTINGS, createDoc, doneCount, normalizeSettings, titleFromFileName, titleFromSource } from './doc';

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
