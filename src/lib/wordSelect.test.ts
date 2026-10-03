import { describe, expect, it } from 'vitest';
import { addKeyphrase } from './blocks';
import { initialSel, moveForKey, moveSel, selAfter, selRange, wordSpans } from './wordSelect';

const text = 'Время ценно, и его надо планировать заранее.';
const words = wordSpans(text, 'ru');
const slice = (r: { start: number; end: number }) => text.slice(r.start, r.end);

describe('выбор слов с клавиатуры', () => {
  it('слова без пунктуации', () => {
    expect(words.map(slice)).toEqual(['Время', 'ценно', 'и', 'его', 'надо', 'планировать', 'заранее']);
  });

  it('начинается с первого слова, не занятого фразой', () => {
    expect(initialSel(words, [])).toEqual({ from: 0, to: 0 });
    expect(initialSel(words, [{ start: 0, end: 11 }])).toEqual({ from: 2, to: 2 });
    expect(initialSel(words, [{ start: 0, end: text.length }])).toEqual({ from: 0, to: 0 });
    expect(initialSel([], [])).toBeNull();
  });

  it('с текстом пропускает короткие слова («в», «и»)', () => {
    const t = 'В мире и во времени ценно всё.';
    const w = wordSpans(t, 'ru');
    expect(initialSel(w, [], t)).toEqual({ from: 1, to: 1 });
    const onlyShort = 'В и на.';
    expect(initialSel(wordSpans(onlyShort, 'ru'), [], onlyShort)).toEqual({ from: 0, to: 0 });
  });

  it('правая граница: вправо растёт, влево сжимается до одного слова', () => {
    let s = { from: 1, to: 1 };
    s = moveSel(s, 'end-right', words.length);
    s = moveSel(s, 'end-right', words.length);
    expect(s).toEqual({ from: 1, to: 3 });
    s = moveSel(s, 'end-left', words.length);
    s = moveSel(s, 'end-left', words.length);
    s = moveSel(s, 'end-left', words.length);
    expect(s).toEqual({ from: 1, to: 1 });
  });

  it('левая граница: влево растёт, вправо сжимается до одного слова', () => {
    let s = { from: 3, to: 4 };
    s = moveSel(s, 'start-left', words.length);
    expect(s).toEqual({ from: 2, to: 4 });
    for (let i = 0; i < 5; i++) s = moveSel(s, 'start-right', words.length);
    expect(s).toEqual({ from: 4, to: 4 });
  });

  it('границы не выходят за текст', () => {
    expect(moveSel({ from: 0, to: 0 }, 'start-left', 7)).toEqual({ from: 0, to: 0 });
    expect(moveSel({ from: 6, to: 6 }, 'end-right', 7)).toEqual({ from: 6, to: 6 });
    expect(moveSel({ from: 0, to: 0 }, 'end-right', 1)).toEqual({ from: 0, to: 0 });
  });

  it('клавиши', () => {
    expect(moveForKey('ArrowRight', false)).toBe('end-right');
    expect(moveForKey('ArrowLeft', false)).toBe('end-left');
    expect(moveForKey('ArrowLeft', true)).toBe('start-left');
    expect(moveForKey('ArrowRight', true)).toBe('start-right');
    expect(moveForKey('ArrowUp', false)).toBeNull();
  });

  it('диапазон символов и добавление совпадают с выделением мышью', () => {
    const r = selRange(words, { from: 3, to: 5 });
    expect(slice(r)).toBe('его надо планировать');
    const res = addKeyphrase([], text, r.start, r.end, 'ru');
    expect(res.ok && res.phrases).toEqual([r]);
  });

  it('пересечение с существующей фразой отклоняется той же проверкой, что и у мыши', () => {
    const existing = [{ start: words[4]!.start, end: words[5]!.end }];
    const r = selRange(words, { from: 3, to: 4 });
    expect(addKeyphrase(existing, text, r.start, r.end, 'ru')).toEqual({ ok: false, reason: 'overlap' });
    const free = selRange(words, { from: 1, to: 3 });
    expect(addKeyphrase(existing, text, free.start, free.end, 'ru').ok).toBe(true);
  });

  it('после добавления выделение уходит на следующее слово, у конца остаётся на последнем', () => {
    expect(selAfter(words, selRange(words, { from: 1, to: 2 }))).toEqual({ from: 3, to: 3 });
    expect(selAfter(words, selRange(words, { from: 5, to: 6 }))).toEqual({ from: 6, to: 6 });
  });
});
