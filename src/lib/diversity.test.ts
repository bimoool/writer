import { describe, expect, it } from 'vitest';
import { VOCAB } from './__fixtures__/vocab';
import { buildCheckText } from './checkText';
import { analyzeDiversity } from './diversity';
import { stem } from './stem';
import { isStopword } from './stopwords';

const check = (text: string) => buildCheckText([{ id: 'b', paragraphIndex: 0, kind: 'text', userText: text }]);
/** Текст из слов, по пять в предложении. */
const asText = (words: string[]) => words.map((w, i) => (i % 5 === 4 ? `${w}.` : w)).join(' ');
const distinct = (n: number, from = 0) => VOCAB.slice(from, from + n);

describe('словарь для тестов', () => {
  it('слова значимые и с разными основами', () => {
    expect(VOCAB.length).toBeGreaterThanOrEqual(300);
    expect(VOCAB.some((w) => isStopword(w) || w.length < 4)).toBe(false);
    expect(new Set(VOCAB.map(stem)).size).toBe(VOCAB.length);
  });
});

describe('разнообразие слов', () => {
  it('меньше 100 значимых слов: мало данных', () => {
    const r = analyzeDiversity(check(asText(distinct(80))));
    expect(r.status).toBe('tooShort');
    expect(r.significant).toBe(80);
  });
  it('пустой текст и одни стоп-слова: мало данных', () => {
    expect(analyzeDiversity(check('')).status).toBe('tooShort');
    expect(analyzeDiversity(check(Array(300).fill('это').join(' '))).status).toBe('tooShort');
  });
  it('все слова разные: доля 1, бедных окон нет', () => {
    const r = analyzeDiversity(check(asText(distinct(100))));
    expect(r.status).toBe('ok');
    expect(r.windows).toHaveLength(1);
    expect(r.windows[0]!.ratio).toBe(1);
    expect(r.windows[0]!.low).toBe(false);
  });
  it('бедное окно среди богатых находится, слова-повторы названы', () => {
    const poor = Array.from({ length: 100 }, (_, i) => (i % 2 ? 'работа' : 'проект'));
    const r = analyzeDiversity(check(asText([...distinct(100), ...poor, ...distinct(100, 100)])));
    expect(r.windows.map((w) => w.low)).toEqual([false, true, false]);
    expect(r.windows[1]!.top.map((t) => t.word).sort()).toEqual(['проект', 'работа']);
    expect(r.windows[1]!.top[0]!.count).toBe(50);
  });
  it('одно окно сравнивать не с чем: не помечается', () => {
    const poor = Array.from({ length: 100 }, (_, i) => (i % 2 ? 'работа' : 'проект'));
    expect(analyzeDiversity(check(asText(poor))).windows[0]!.low).toBe(false);
  });
  it('формы одного слова считаются одной основой', () => {
    const forms = ['работа', 'работы', 'работе', 'работу', 'работой'];
    const r = analyzeDiversity(check(asText([...distinct(95), ...forms])));
    expect(r.windows[0]!.ratio).toBeCloseTo(96 / 100, 6);
  });
});
