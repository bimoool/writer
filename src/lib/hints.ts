import { tokenize, type Lang } from './tokens';
import type { BlockHints, Keyphrase } from './types';

/**
 * Лестница подсказок (SPEC §3.4): 1 Темы, 2 Скелет, 3 Первые буквы, 4 Подглядеть.
 * Здесь чистая логика: что показывать на ступенях 2–3 и как считать статистику.
 */

export const PEEK_MAX_MS = 3000;
/** Ширина плашки на одну букву слова, em (DESIGN §6.3). */
export const PLATE_EM = 0.52;

export type HintLevel = 1 | 2 | 3;
export type SkeletonMode = 'skeleton' | 'letters';

export type SkeletonPart =
  /** Знаки препинания и пробелы между словами. Букв и цифр здесь нет по построению. */
  | { kind: 'text'; text: string }
  /** Ключевая фраза целиком. */
  | { kind: 'phrase'; text: string; index: number }
  /** Слово, которое не входит в ключевые фразы: только длина, самого слова в разметке нет. */
  | { kind: 'plate'; length: number }
  /** Ступень 3: первая буква слова и плашка на оставшуюся длину. */
  | { kind: 'letter'; letter: string; rest: number };

const length = (s: string) => Array.from(s).length;
const NOT_WORD = /[\p{L}\p{N}]/gu;

/**
 * Разбивает блок для скелета и первых букв. Слова, не входящие в ключевые фразы, превращаются в плашки
 * (на ступени 3 в первую букву и плашку), ключевые фразы остаются текстом, пунктуация и пробелы сохраняются.
 * Ключевые фразы на ступени 3 видны целиком: ступень раскрывает больше предыдущей, а не меньше.
 *
 * Защита от утечки: между словами выдаётся только то, что осталось после удаления букв и цифр, так что даже
 * неточные смещения фраз не пронесут слово в разметку.
 */
export function skeletonParts(text: string, keyphrases: Keyphrase[], mode: SkeletonMode, lang?: Lang): SkeletonPart[] {
  const phrases = keyphrases
    .map((p, index) => ({ ...p, index }))
    .filter((p) => p.start >= 0 && p.end > p.start && p.end <= text.length)
    .sort((a, b) => a.start - b.start);

  type Item = { start: number; end: number; part: SkeletonPart };
  const items: Item[] = [];
  let reach = 0;
  for (const p of phrases) {
    if (p.start < reach) continue; // пересечение с предыдущей фразой
    items.push({ start: p.start, end: p.end, part: { kind: 'phrase', text: text.slice(p.start, p.end), index: p.index } });
    reach = p.end;
  }
  const covered = (start: number, end: number) => items.some((i) => start < i.end && end > i.start);
  for (const t of tokenize(text, lang)) {
    if (covered(t.start, t.end)) continue;
    const n = length(t.text);
    items.push({
      start: t.start,
      end: t.end,
      part: mode === 'letters' ? { kind: 'letter', letter: Array.from(t.text)[0]!, rest: n - 1 } : { kind: 'plate', length: n },
    });
  }
  items.sort((a, b) => a.start - b.start);

  const out: SkeletonPart[] = [];
  let pos = 0;
  const gap = (end: number) => {
    const between = text.slice(pos, end).replace(NOT_WORD, '');
    if (between) out.push({ kind: 'text', text: between });
  };
  for (const item of items) {
    if (item.start < pos) continue;
    gap(item.start);
    out.push(item.part);
    pos = item.end;
  }
  gap(text.length);
  return out;
}

// --- статистика (SPEC §3.4) -----------------------------------------------------------------

const level = (n: number) => n as BlockHints['maxLevel'];

/** Ступень 1–3 открыта. Закрытие не считается: учитываем каждое открытие. */
export const openLevel = (h: BlockHints, lvl: HintLevel): BlockHints => ({
  ...h,
  maxLevel: level(Math.max(h.maxLevel, lvl)),
  opens: { ...h.opens, [lvl]: h.opens[lvl] + 1 },
});

/** Началось подглядывание: одно удержание = один peek. */
export const startPeek = (h: BlockHints): BlockHints => ({ ...h, maxLevel: 4, peeks: h.peeks + 1 });

/** Подглядывание закончилось: прибавляем длительность, но не больше PEEK_MAX_MS. */
export const endPeek = (h: BlockHints, ms: number): BlockHints => ({
  ...h,
  peekMs: h.peekMs + Math.min(PEEK_MAX_MS, Math.max(0, Math.round(ms))),
});
