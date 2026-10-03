import { describe, expect, it } from 'vitest';
import { computeMetrics, ownWords, toPercent, trigrams } from './metrics';
import type { Block } from './types';

const SRC = 'Техника Pomodoro предлагает работать короткими интервалами по двадцать пять минут.';

describe('«Свои слова» (SPEC §9)', () => {
  it('дословная копия даёт 0%', () => {
    expect(ownWords([SRC], [SRC])).toBe(0);
  });

  it('копия с другими падежами и ё тоже даёт 0%: сравниваются основы', () => {
    expect(ownWords([SRC], ['техникой pomodoro предлагают работать короткими интервалами по двадцать пять минут'])).toBe(0);
  });

  it('полностью свой пересказ даёт 100%', () => {
    expect(ownWords([SRC], ['Есть такой метод: полчаса трудишься, потом отдыхаешь.'])).toBe(1);
  });

  it('частичное совпадение считается долей пользовательских 3-грамм', () => {
    // 3-граммы пользователя: «я работать коротк», «работать коротк интервал», «коротк интервал сегодня».
    // Общая с исходником одна: «работать коротк интервал».
    const share = ownWords([SRC], ['Я работать короткими интервалами сегодня']);
    expect(share).toBeCloseTo(2 / 3, 5);
    expect(toPercent(share)).toBe(67);
  });

  it('меньше трёх слов у пользователя: метрика не определена', () => {
    expect(ownWords([SRC], ['Два слова'])).toBeNull();
    expect(toPercent(null)).toBeNull();
  });

  it('3-граммы считаются как множество', () => {
    expect(trigrams(['а', 'б', 'в', 'а', 'б', 'в']).size).toBe(3);
  });
});

const block = (over: Partial<Block>): Block => ({
  id: 'b',
  paragraphIndex: 0,
  kind: 'text',
  sourceText: SRC,
  keyphrases: [],
  userText: '',
  status: 'done',
  hints: { maxLevel: 0, opens: { 1: 0, 2: 0, 3: 0 }, peeks: 0, peekMs: 0 },
  typedChars: 0,
  pastedChars: 0,
  activeMs: 0,
  ...over,
});

describe('computeMetrics', () => {
  it('суммирует время, слова, подсказки, подглядывания и долю набранного', () => {
    const m = computeMetrics([
      block({
        userText: 'Работаешь полчаса и отдыхаешь.',
        activeMs: 60_000,
        typedChars: 90,
        pastedChars: 10,
        hints: { maxLevel: 4, opens: { 1: 2, 2: 1, 3: 0 }, peeks: 2, peekMs: 3_500 },
      }),
      block({
        userText: 'Короткие рывки помогают держать фокус.',
        activeMs: 30_000,
        typedChars: 100,
        hints: { maxLevel: 1, opens: { 1: 3, 2: 0, 3: 0 }, peeks: 0, peekMs: 0 },
      }),
    ]);
    expect(m.activeMs).toBe(90_000);
    expect(m.wordsWritten).toBe(9);
    expect(m.opens).toEqual({ 1: 5, 2: 1, 3: 0 });
    expect(m.peeks).toBe(2);
    expect(m.peekMs).toBe(3_500);
    expect(m.typedShare).toBeCloseTo(190 / 200, 5);
    expect(m.ownWords).toBe(1);
  });

  it('без набранного и вставленного доля набранного не определена', () => {
    expect(computeMetrics([block({})]).typedShare).toBeNull();
  });
});
