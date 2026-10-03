import { describe, expect, it } from 'vitest';
import { advance, IDLE_CAP_MS } from './activity';
import { APPENDIX_A } from './__fixtures__/appendix-a';
import { createDoc } from './doc';
import { canFinish, completeBlock, frontierIndex, initialPhase, patchBlock, startWriting } from './session';

const fresh = () => createDoc(APPENDIX_A);

describe('состояния блока', () => {
  it('pending открывается в reading, writing и done сразу в writing', () => {
    const b = fresh().blocks[0]!;
    expect(initialPhase({ ...b, status: 'pending' })).toBe('reading');
    expect(initialPhase({ ...b, status: 'writing' })).toBe('writing');
    expect(initialPhase({ ...b, status: 'done' })).toBe('writing');
  });

  it('«Запомнил» переводит pending в writing и не откатывает writing и done', () => {
    const doc = fresh();
    expect(startWriting(doc, 0).blocks[0]!.status).toBe('writing');
    const done = patchBlock(doc, 0, () => ({ status: 'done' }));
    expect(startWriting(done, 0).blocks[0]!.status).toBe('done');
  });

  it('frontierIndex: первый незавершённый блок', () => {
    let doc = fresh();
    expect(frontierIndex(doc)).toBe(0);
    doc = completeBlock(doc, 0, 1);
    expect(frontierIndex(doc)).toBe(1);
    doc = completeBlock(completeBlock(doc, 1, 2), 2, 3);
    expect(frontierIndex(doc)).toBe(3);
  });

  it('пустой блок завершить нельзя, одно слово можно', () => {
    for (const t of ['', '   ', '\n\n', '...', '😀']) expect(canFinish(t)).toBe(false);
    for (const t of ['Да', ' Да. ', 'два слова']) expect(canFinish(t)).toBe(true);
  });
});

describe('completeBlock', () => {
  it('блок становится done, currentIndex указывает на следующий', () => {
    const doc = completeBlock(fresh(), 0, 100);
    expect(doc.blocks[0]!.status).toBe('done');
    expect(doc.currentIndex).toBe(1);
    expect(doc.finishedAt).toBeUndefined();
  });

  it('последний блок ставит finishedAt, currentIndex остаётся на последнем', () => {
    let doc = fresh();
    for (let i = 0; i < doc.blocks.length; i++) doc = completeBlock(doc, i, 500 + i);
    expect(doc.finishedAt).toBe(502);
    expect(doc.currentIndex).toBe(doc.blocks.length - 1);
  });

  it('правка уже завершённого блока не сдвигает currentIndex и не меняет finishedAt', () => {
    let doc = fresh();
    for (let i = 0; i < doc.blocks.length; i++) doc = completeBlock(doc, i, 500);
    const again = completeBlock(doc, 0, 999);
    expect(again.finishedAt).toBe(500);
    expect(again.currentIndex).toBe(doc.currentIndex);

    const mid = completeBlock(completeBlock(fresh(), 0, 1), 1, 2);
    const edited = completeBlock(mid, 0, 3);
    expect(edited.currentIndex).toBe(2);
  });

  it('не мутирует исходный документ', () => {
    const doc = fresh();
    completeBlock(doc, 0, 1);
    expect(doc.blocks[0]!.status).toBe('pending');
  });
});

describe('активное время', () => {
  it('первое событие время не прибавляет, дальше от события до события', () => {
    expect(advance(null, 1000)).toEqual({ ms: 0, last: 1000 });
    expect(advance(1000, 4500)).toEqual({ ms: 3500, last: 4500 });
  });

  it('длинный простой обрезается до IDLE_CAP_MS', () => {
    expect(advance(0, 60 * 60_000).ms).toBe(IDLE_CAP_MS);
  });

  it('часы, ушедшие назад, не дают отрицательного времени', () => {
    expect(advance(5000, 1000).ms).toBe(0);
  });
});
