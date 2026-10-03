import { tokenize, type Lang } from './tokens';
import type { Keyphrase } from './types';

/**
 * Выбор ключевой фразы с клавиатуры (Split, режим «Выбрать слова»). Выделение — диапазон слов блока
 * [from, to] по индексам слов; границы двигаются стрелками на одно слово.
 */

export interface WordSel {
  from: number;
  to: number;
}

export type SelMove = 'end-right' | 'end-left' | 'start-left' | 'start-right';

export const wordSpans = (text: string, lang?: Lang): Keyphrase[] => tokenize(text, lang).map((t) => ({ start: t.start, end: t.end }));

const inside = (w: Keyphrase, p: Keyphrase) => w.start >= p.start && w.end <= p.end;

/**
 * Начальное выделение: первое слово, не входящее в уже выбранную фразу и не короче трёх букв (с союза или предлога
 * выбирать нечего). Если таких нет, первое слово, не занятое фразой, иначе первое слово. Нет слов: null.
 */
export function initialSel(words: Keyphrase[], phrases: Keyphrase[], text?: string): WordSel | null {
  if (words.length === 0) return null;
  const free = (w: Keyphrase) => !phrases.some((p) => inside(w, p));
  const solid = text === undefined ? -1 : words.findIndex((w) => free(w) && /\p{L}{3,}|\d/u.test(text.slice(w.start, w.end)));
  const any = words.findIndex(free);
  const i = solid >= 0 ? solid : any >= 0 ? any : 0;
  return { from: i, to: i };
}

/** Сдвиг одной границы на слово. Выделение не пустеет: минимум одно слово, и границы не выходят за текст. */
export function moveSel(sel: WordSel, move: SelMove, count: number): WordSel {
  const last = Math.max(0, count - 1);
  switch (move) {
    case 'end-right':
      return { from: sel.from, to: Math.min(last, sel.to + 1) };
    case 'end-left':
      return { from: sel.from, to: Math.max(sel.from, sel.to - 1) };
    case 'start-left':
      return { from: Math.max(0, sel.from - 1), to: sel.to };
    case 'start-right':
      return { from: Math.min(sel.to, sel.from + 1), to: sel.to };
  }
}

/** Диапазон символов, который покрывает выделение. */
export function selRange(words: Keyphrase[], sel: WordSel): Keyphrase {
  return { start: words[sel.from]!.start, end: words[sel.to]!.end };
}

/** Следующее выделение после добавления фразы: первое слово за ней (или последнее слово, если дальше нет). */
export function selAfter(words: Keyphrase[], added: Keyphrase): WordSel {
  const next = words.findIndex((w) => w.start >= added.end);
  const i = next < 0 ? words.length - 1 : next;
  return { from: i, to: i };
}

/** Клавиша → сдвиг границы. Стрелки двигают правую границу, Shift+стрелки левую. */
export function moveForKey(key: string, shift: boolean): SelMove | null {
  if (key === 'ArrowRight') return shift ? 'start-right' : 'end-right';
  if (key === 'ArrowLeft') return shift ? 'start-left' : 'end-left';
  return null;
}
