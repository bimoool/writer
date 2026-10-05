import type { Range } from './checkText';

/**
 * Орфография (SPEC §15.1): какие слова вообще проверять и как понять, что слово неверно.
 * Сам словарь (nspell) подключается снаружи, здесь только чистая логика, которую можно тестировать без словаря.
 */

export interface Candidate extends Range {
  word: string;
}

const WORD_RE = /[\p{L}\p{M}\p{N}_][\p{L}\p{M}\p{N}_'’-]*/gu;
const URL_RE = /(?:https?:\/\/|www\.)\S+|\S+@\S+\.\S+/giu;
const OPENERS = /[«"“„([—–-]/u;

/** Слово стоит в начале предложения: перед ним ничего нет или конец предыдущего. */
function atSentenceStart(text: string, pos: number): boolean {
  let i = pos - 1;
  while (i >= 0 && (/\s/.test(text[i]!) || OPENERS.test(text[i]!))) {
    if (text[i] === '\n') return true;
    i--;
  }
  return i < 0 || /[.!?…:]/.test(text[i]!);
}

const isCapitalized = (w: string) => /^\p{Lu}\p{Ll}/u.test(w);
const isAllCaps = (w: string) => w.length > 1 && w === w.toUpperCase() && w !== w.toLowerCase();

/**
 * Слова, которые стоит проверять. Не проверяются: числа и слова с цифрами, ссылки и адреса, слова с латиницей,
 * сокращения из заглавных букв, одиночные буквы и слова с заглавной посреди предложения (скорее всего имена).
 */
export function spellCandidates(text: string): Candidate[] {
  const masked: Range[] = [];
  for (const m of text.matchAll(URL_RE)) masked.push({ start: m.index, end: m.index + m[0].length });
  const out: Candidate[] = [];
  for (const m of text.matchAll(WORD_RE)) {
    const start = m.index;
    const end = start + m[0].length;
    if (masked.some((r) => start < r.end && end > r.start)) continue;
    // Тире и апострофы по краям не часть слова.
    const word = m[0].replace(/^['’-]+|['’-]+$/g, '');
    const trimStart = m[0].indexOf(word);
    if (!word || /[\d_]/.test(word) || /[A-Za-z]/.test(word)) continue;
    if ([...word].filter((c) => /\p{L}/u.test(c)).length < 2) continue;
    if (isAllCaps(word)) continue;
    const s = start + trimStart;
    if (isCapitalized(word) && !atSentenceStart(text, s)) continue;
    out.push({ word, start: s, end: s + word.length });
  }
  return out;
}

const MAX_YO_COMBINATIONS = 6;

/** Варианты слова с другой расстановкой ё: без ё вовсе и со всеми комбинациями ё вместо е. */
function yoVariants(word: string): string[] {
  const variants = new Set<string>();
  if (word.includes('ё') || word.includes('Ё')) variants.add(word.replace(/ё/g, 'е').replace(/Ё/g, 'Е'));
  const positions = [...word].flatMap((c, i) => (c === 'е' || c === 'Е' ? [i] : []));
  if (positions.length > 0 && positions.length <= MAX_YO_COMBINATIONS) {
    for (let mask = 1; mask < 1 << positions.length; mask++) {
      const chars = [...word];
      positions.forEach((pos, bit) => {
        if (mask & (1 << bit)) chars[pos] = chars[pos] === 'Е' ? 'Ё' : 'ё';
      });
      variants.add(chars.join(''));
    }
  }
  return [...variants];
}

/**
 * Слово верно, если его знает словарь, если знает каждую часть через дефис или если верно после замены е на ё
 * (и наоборот): ё в обычном письме часто опускают, ошибкой это не считается.
 */
export function isWordOk(word: string, correct: (w: string) => boolean): boolean {
  if (correct(word)) return true;
  if (yoVariants(word).some(correct)) return true;
  if (word.includes('-')) {
    const parts = word.split('-').filter(Boolean);
    return parts.length > 1 && parts.every((p) => correct(p) || yoVariants(p).some(correct));
  }
  return false;
}

/** Слова из списка, которые словарь не знает. */
export const misspelled = (words: string[], correct: (w: string) => boolean): string[] => words.filter((w) => !isWordOk(w, correct));

/** Расстояние Дамерау — Левенштейна (вставка, удаление, замена, перестановка соседних букв). */
export function editDistance(a: string, b: string): number {
  const x = [...a.toLowerCase()];
  const y = [...b.toLowerCase()];
  const d: number[][] = Array.from({ length: x.length + 1 }, (_, i) => [i, ...Array<number>(y.length).fill(0)]);
  for (let j = 1; j <= y.length; j++) d[0]![j] = j;
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  }
  return d[x.length]![y.length]!;
}

/**
 * Лучшие варианты исправления. Словарь отдаёт кандидатов в порядке, малополезном для опечаток («превет» → «ревет», «преет», …,
 * «привет» в конце), поэтому порядок наш: меньше правок, затем та же длина (опечатка чаще замена или перестановка, чем
 * пропуск), затем та же первая буква, затем порядок словаря.
 */
export function rankSuggestions(word: string, candidates: string[], limit = 3): string[] {
  const score = (c: string, i: number) =>
    editDistance(word, c) * 10 + ([...c].length === [...word].length ? 0 : 3) + (c[0]?.toLowerCase() === word[0]?.toLowerCase() ? 0 : 4) + i * 0.1;
  return candidates
    .map((c, i) => ({ c, s: score(c, i) }))
    .sort((a, b) => a.s - b.s)
    .slice(0, limit)
    .map((x) => x.c);
}
