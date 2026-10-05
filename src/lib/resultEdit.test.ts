import { describe, expect, it } from 'vitest';
import { computeMetrics } from './metrics';
import { applyEdit, leaveEdit } from './resultEdit';
import { createDoc } from './doc';
import { APPENDIX_A } from './__fixtures__/appendix-a';
import type { Doc } from './types';

function finished(): Doc {
  const d = createDoc(APPENDIX_A, { blockSize: 'long' });
  return {
    ...d,
    blocks: d.blocks.map((b) => ({ ...b, status: 'done', userText: b.sourceText, typedChars: 0, pastedChars: b.sourceText.length })),
    currentIndex: d.blocks.length,
  };
}

describe('правка на Result: подсчёт', () => {
  it('набранное и вставленное копятся как в Session', () => {
    const d = finished();
    const id = d.blocks[0]!.id;
    const after = applyEdit(applyEdit(d, id, 'Мой текст', { typed: 9, pasted: 0 }), id, 'Мой текст ещё', { typed: 0, pasted: 5 });
    expect(after.blocks[0]).toMatchObject({ userText: 'Мой текст ещё', typedChars: 9, pastedChars: d.blocks[0]!.pastedChars + 5 });
    expect(after.blocks[1]).toBe(d.blocks[1]);
  });

  it('метрики пересчитываются по новому тексту', () => {
    const d = finished();
    const before = computeMetrics(d.blocks);
    expect(before.ownWords).toBe(0); // текст пользователя совпал с исходником
    const edited = d.blocks.reduce(
      (doc, b) => applyEdit(doc, b.id, 'Совсем другие слова про распорядок дня и отдых между делами', { typed: 56, pasted: 0 }),
      d,
    );
    const after = computeMetrics(edited.blocks);
    expect(after.ownWords).toBeGreaterThan(0.9);
    expect(after.typedShare).not.toBe(before.typedShare);
    expect(edited.blocks[0]!.typedChars).toBe(56);
  });

  it('пустое значение в документ не пишется', () => {
    const d = finished();
    const id = d.blocks[0]!.id;
    expect(applyEdit(d, id, '   ', { typed: 0, pasted: 0 })).toBe(d);
  });

  it('неизвестный блок игнорируется', () => {
    const d = finished();
    expect(applyEdit(d, 'нет-такого', 'текст', { typed: 5, pasted: 0 })).toBe(d);
  });
});

describe('выход из поля', () => {
  it('непустой текст остаётся', () => {
    const d = finished();
    expect(leaveEdit(d, d.blocks[0]!.id, 'слово', 'было').restored).toBe(false);
  });
  it('пустой возвращает текст, с которым поле открыли', () => {
    const d = applyEdit(finished(), finished().blocks[0]!.id, 'x', { typed: 1, pasted: 0 });
    const r = leaveEdit(d, d.blocks[0]!.id, '  ', 'исходный пересказ');
    expect(r.restored).toBe(true);
    expect(r.doc.blocks[0]!.userText).toBe('исходный пересказ');
  });
});
