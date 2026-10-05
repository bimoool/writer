import { describe, expect, it } from 'vitest';
import type { CheckPart } from './checkText';
import { markSegments, type Finding } from './findings';

const part: CheckPart = { blockId: 'b', start: 10, end: 40, lead: 0 };
const f = (id: string, start: number, end: number): Finding => ({ id, kind: 'read', sub: 'long', tone: 'read', words: 30, start, end });

describe('отрезки подсветки', () => {
  it('одна находка — один отрезок в координатах блока', () => {
    expect(markSegments(part, [f('a', 12, 20)])).toEqual([{ start: 2, end: 10, ids: ['a'] }]);
  });
  it('находка за пределами куска отсекается, на границе обрезается', () => {
    expect(markSegments(part, [f('a', 0, 9), f('b', 35, 60)])).toEqual([{ start: 25, end: 30, ids: ['b'] }]);
  });
  it('пересечение делит границы, самая узкая находка первая', () => {
    const segs = markSegments(part, [f('wide', 10, 30), f('narrow', 15, 20)]);
    expect(segs).toEqual([
      { start: 0, end: 5, ids: ['wide'] },
      { start: 5, end: 10, ids: ['narrow', 'wide'] },
      { start: 10, end: 20, ids: ['wide'] },
    ]);
  });
  it('нет находок — нет отрезков', () => expect(markSegments(part, [])).toEqual([]));
});
