/**
 * Токенизация на основе Intl.Segmenter (SPEC §5 п.1).
 * Сегментер режет «1980-х», «25%», «e-mail» и URL на части. Поэтому соседние сегменты,
 * склеенные без пробела через «соединители» (дефис, точка, слэш…), собираем в один токен.
 * Так URL и длинные составные слова никогда не режутся внутри.
 */

export type Lang = 'ru' | 'en';

export interface Token {
  text: string;
  start: number;
  end: number;
}

const JOINERS = new Set(['-', '‐', '‑', "'", '’', '/', ':', '.', '@', '_', '?', '=', '&', '#', '+', '~', '%']);

const segmenters = new Map<string, Intl.Segmenter>();

export function segmenter(lang: Lang, granularity: 'word' | 'sentence'): Intl.Segmenter {
  const key = `${lang}:${granularity}`;
  let s = segmenters.get(key);
  if (!s) {
    s = new Intl.Segmenter(lang, { granularity });
    segmenters.set(key, s);
  }
  return s;
}

/** Язык по доле кириллицы среди букв: от 30% кириллицы считаем текст русским. */
export function detectLang(text: string): Lang {
  const cyr = text.match(/[а-яё]/gi)?.length ?? 0;
  const lat = text.match(/[a-z]/gi)?.length ?? 0;
  if (cyr + lat === 0) return 'ru';
  return cyr / (cyr + lat) >= 0.3 ? 'ru' : 'en';
}

const isJoiner = (s: string) => [...s].every((c) => JOINERS.has(c));

export function tokenize(text: string, lang: Lang = detectLang(text)): Token[] {
  const out: Token[] = [];
  type Seg = { text: string; index: number; word: boolean };
  let group: Seg[] = [];

  const flush = () => {
    let a = 0;
    let b = group.length - 1;
    while (a <= b && !group[a]!.word) a++;
    while (b >= a && !group[b]!.word) {
      // «25%» оставляем с процентом
      if (group[b]!.text === '%' && b > a && /\d$/.test(group[b - 1]!.text)) break;
      b--;
    }
    if (a <= b) {
      const start = group[a]!.index;
      const last = group[b]!;
      const end = last.index + last.text.length;
      out.push({ text: text.slice(start, end), start, end });
    }
    group = [];
  };

  for (const s of segmenter(lang, 'word').segment(text)) {
    if (s.isWordLike) group.push({ text: s.segment, index: s.index, word: true });
    else if (isJoiner(s.segment)) group.push({ text: s.segment, index: s.index, word: false });
    else flush();
  }
  flush();
  return out;
}

export const countWords = (text: string, lang?: Lang) => tokenize(text, lang).length;

/** Нижний регистр и ё → е (SPEC §5 п.2). */
export const normalize = (word: string) => word.toLowerCase().replace(/ё/g, 'е');

export const hasDigit = (s: string) => /\d/.test(s);
export const hasLatin = (s: string) => /[a-z]/i.test(s);
export const hasCyrillic = (s: string) => /[а-яё]/i.test(s);
export const letterCount = (s: string) => s.match(/\p{L}/gu)?.length ?? 0;
