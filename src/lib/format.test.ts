import { describe, expect, it } from 'vitest';
import { formatDocDate, plural } from './format';

const words = { today: 'сегодня', yesterday: 'вчера' };
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

describe('plural', () => {
  it('склонение числительных', () => {
    const f = (n: number) => plural(n, 'документ', 'документа', 'документов');
    expect([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 100, 101, 111, 0].map(f)).toEqual([
      'документ', 'документа', 'документа', 'документов', 'документов', 'документов', 'документов',
      'документ', 'документа', 'документов', 'документов', 'документ', 'документов', 'документов',
    ]);
  });
});

describe('formatDocDate', () => {
  const now = at(2026, 10, 3, 15);
  it('сегодня, вчера и по календарным дням, а не по 24 часам', () => {
    expect(formatDocDate(at(2026, 10, 3, 1), now, words)).toBe('сегодня');
    expect(formatDocDate(at(2026, 10, 2, 23), at(2026, 10, 3, 0), words)).toBe('вчера');
    expect(formatDocDate(at(2026, 10, 2, 8), now, words)).toBe('вчера');
  });
  it('в этом году: день и месяц без точки', () => {
    expect(formatDocDate(at(2026, 10, 1), now, words)).toBe('1 окт');
    expect(formatDocDate(at(2026, 1, 15), now, words)).toBe('15 янв');
    expect(formatDocDate(at(2026, 5, 9), now, words)).toBe('9 мая');
  });
  it('в прошлые годы добавляется год', () => {
    expect(formatDocDate(at(2025, 12, 31), at(2026, 1, 2), words)).toBe('31 дек 2025');
  });
  it('дата из будущего (сбитые часы) показывается как сегодня', () => {
    expect(formatDocDate(at(2026, 10, 9), now, words)).toBe('сегодня');
  });
});
