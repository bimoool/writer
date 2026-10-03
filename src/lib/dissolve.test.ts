import { describe, expect, it } from 'vitest';
import {
  JITTER_MS,
  MAX_DISSOLVE_MS,
  STEP_MS,
  WORD_MS,
  dissolveBound,
  dissolveDelays,
  dissolveEnd,
  dissolveStep,
} from './dissolve';

describe('шаг растворения', () => {
  it('до 18 слов шаг 22 мс, как в DESIGN §6.1', () => {
    for (const n of [2, 5, 15, 18]) expect(dissolveStep(n)).toBe(STEP_MS);
  });

  it('с 19 слов шаг сжимается, а не остаётся 22 мс: иначе 1,1 с не выдержать', () => {
    expect(dissolveStep(19)).toBeLessThan(STEP_MS);
    expect(dissolveStep(60)).toBeCloseTo((MAX_DISSOLVE_MS - WORD_MS - JITTER_MS) / 59, 6);
  });

  it('DESIGN сжимает шаг с 31 слова, но блок из 30 слов при шаге 22 мс длился бы 1348 мс', () => {
    expect(29 * STEP_MS + JITTER_MS + WORD_MS).toBe(1348);
    expect(dissolveBound(30)).toBeLessThanOrEqual(MAX_DISSOLVE_MS);
  });

  it('одно слово и пустой блок', () => {
    expect(dissolveStep(1)).toBe(0);
    expect(dissolveStep(0)).toBe(0);
    expect(dissolveBound(0)).toBe(0);
    expect(dissolveBound(1)).toBe(JITTER_MS + WORD_MS);
  });
});

describe('время растворения', () => {
  it('блок из 15 слов: 14 × 22 + 60 + 650 = 1018 мс в худшем случае', () => {
    expect(dissolveBound(15)).toBe(1018);
  });

  it('блок из 60 слов укладывается ровно в 1100 мс в худшем случае', () => {
    expect(dissolveBound(60)).toBeCloseTo(1100, 6);
  });

  it('для любого числа слов худший случай не больше 1100 мс', () => {
    for (let n = 1; n <= 1000; n++) expect(dissolveBound(n)).toBeLessThanOrEqual(MAX_DISSOLVE_MS + 1e-9);
  });

  it('случайность на максимуме и на нуле: конец не позже границы', () => {
    for (const n of [1, 15, 30, 60, 70, 200]) {
      expect(dissolveEnd(dissolveDelays(n, () => 1))).toBeLessThanOrEqual(dissolveBound(n) + 1e-9);
      expect(dissolveEnd(dissolveDelays(n, () => 0))).toBeLessThanOrEqual(dissolveBound(n) + 1e-9);
      expect(dissolveEnd(dissolveDelays(n, () => 1))).toBeLessThanOrEqual(MAX_DISSOLVE_MS + 1e-9);
    }
  });
});

describe('задержки слов', () => {
  it('задержка = индекс × шаг + случайная добавка 0–60 мс', () => {
    const delays = dissolveDelays(10, () => 0.5);
    delays.forEach((d, i) => expect(d).toBeCloseTo(i * 22 + 30, 6));
  });

  it('по умолчанию добавка случайная и в пределах 0–60 мс', () => {
    const delays = dissolveDelays(40);
    const step = dissolveStep(40);
    delays.forEach((d, i) => {
      expect(d).toBeGreaterThanOrEqual(i * step);
      expect(d).toBeLessThan(i * step + JITTER_MS);
    });
  });

  it('слов столько, сколько запрошено', () => {
    expect(dissolveDelays(0)).toEqual([]);
    expect(dissolveDelays(7)).toHaveLength(7);
    expect(dissolveEnd([])).toBe(0);
  });
});
