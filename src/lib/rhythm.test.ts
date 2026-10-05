import { describe, expect, it } from 'vitest';
import { buildCheckText } from './checkText';
import { analyzeRhythm, evenChains, lengthStats } from './rhythm';

const check = (text: string) => buildCheckText(text.split('\n\n').map((t, i) => ({ id: `b${i}`, paragraphIndex: i, kind: 'text' as const, userText: t })));
const sentence = (n: number) => `Слово${' слово'.repeat(n - 1)}.`;
const para = (...lengths: number[]) => lengths.map(sentence).join(' ');
const rule = { run: 3, maxDiff: 0.15, minWords: 6 };

describe('цепочки одинаковой длины', () => {
  it('три подряд с разницей меньше 15%', () => expect(evenChains([10, 10, 11], rule)).toEqual([{ from: 0, to: 2 }]));
  it('разница 15% и больше — нет', () => expect(evenChains([10, 10, 12], rule)).toEqual([]));
  it('два предложения мало', () => expect(evenChains([10, 10], rule)).toEqual([]));
  it('короткие предложения не в счёт', () => expect(evenChains([3, 3, 3, 3], rule)).toEqual([]));
  it('пересекающиеся окна сливаются в одну цепочку', () => expect(evenChains([10, 10, 10, 10, 30, 8, 8, 8], rule)).toEqual([{ from: 0, to: 3 }, { from: 5, to: 7 }]));
  it('порог из данных: можно ослабить', () => expect(evenChains([10, 10, 12], { ...rule, maxDiff: 0.2 })).toEqual([{ from: 0, to: 2 }]));
  it('пустой список', () => expect(evenChains([], rule)).toEqual([]));
});

describe('разброс длины', () => {
  it('одинаковые длины: разброса нет', () => expect(lengthStats([10, 10, 10]).cv).toBe(0));
  it('стандартное отклонение и коэффициент вариации', () => {
    const s = lengthStats([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(s.mean).toBe(5);
    expect(s.sd).toBe(2);
    expect(s.cv).toBeCloseTo(0.4, 6);
  });
  it('пустой список', () => expect(lengthStats([])).toEqual({ mean: 0, sd: 0, cv: 0 }));
});

describe('ритм текста', () => {
  it('меньше шести предложений не оцениваем', () => {
    expect(analyzeRhythm(check(para(10, 10, 10, 10, 10))).status).toBe('tooShort');
    expect(analyzeRhythm(check('')).status).toBe('tooShort');
    expect(analyzeRhythm(check(sentence(12))).status).toBe('tooShort');
  });
  it('ровный: длины близки', () => {
    const r = analyzeRhythm(check(para(14, 15, 13, 14, 16, 15, 14)));
    expect(r.status).toBe('even');
    expect(r.chains.length).toBeGreaterThan(0);
    expect(r.chains[0]!.count).toBeGreaterThanOrEqual(3);
  });
  it('живой: длины скачут, цепочек нет', () => {
    const r = analyzeRhythm(check(para(4, 22, 7, 15, 3, 28, 9)));
    expect(r.status).toBe('lively');
    expect(r.chains).toEqual([]);
  });
  it('цепочка не переходит через границу абзаца', () => {
    const r = analyzeRhythm(check(`${para(10, 10)}\n\n${para(10, 4, 20, 5)}`));
    expect(r.chains).toEqual([]);
  });
  it('диапазон цепочки покрывает предложения целиком', () => {
    const text = `${para(5, 20)} ${para(10, 10, 10)}`;
    const r = analyzeRhythm(check(text));
    const c = r.chains[0]!;
    expect(text.slice(c.start, c.end)).toBe(para(10, 10, 10));
  });
});
