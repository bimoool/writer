import { stem } from './stem';
import { isBridge, isStopword } from './stopwords';
import { detectLang, hasDigit, hasLatin, letterCount, tokenize, type Lang, type Token } from './tokens';
import type { BlockKind, Keyphrase } from './types';

/** Ключевые фразы без LLM: tf-idf по блокам документа с множителями (SPEC §5). */

export interface KeywordBlock {
  text: string;
  kind?: BlockKind;
}

interface ScoredToken extends Token {
  stem: string;
  significant: boolean;
  bridge: boolean;
  /** Можно ли склеить с предыдущим токеном во фразу (между ними только пробелы или кавычки). */
  joinsPrev: boolean;
  score: number;
}

interface Candidate {
  from: number; // индексы токенов, включительно
  to: number;
  score: number;
  best: number; // индекс самого весомого слова
}

const MAX_PHRASE_WORDS = 3;
const COVER_SHARE = 0.3;
const NEIGHBOR_MIN_SHARE = 0.35;
/** Сколько добавляет фразе каждое соседнее значимое слово относительно своего веса. */
const NEIGHBOR_GAIN = 0.3;
/** Фраза со связкой («рост на 20%») чуть дешевле фразы из подряд идущих значимых слов. */
const BRIDGE_PENALTY = 0.9;
const SHORT_ITEM_WORDS = 8;

export const MULTIPLIERS = { number: 2.0, capital: 1.8, latinInRu: 1.5, long: 1.2 } as const;

/** Сколько фраз нужно блоку по числу слов (SPEC §5 п.6). */
export function targetCount(words: number): number {
  if (words <= 25) return 3;
  if (words <= 35) return 4;
  if (words <= 45) return 5;
  return 6;
}

const isSignificant = (t: Token) => (hasDigit(t.text) || letterCount(t.text) >= 2) && !isStopword(t.text);

function isSentenceStart(text: string, t: Token): boolean {
  const before = text.slice(0, t.start).replace(/[\s«"“„'([—–-]+$/u, '');
  return before === '' || /[.!?…]$/.test(before);
}

function tokenWeight(text: string, t: Token, lang: Lang): number {
  let w = 1;
  if (hasDigit(t.text)) w *= MULTIPLIERS.number;
  if (/^\p{Lu}/u.test(t.text) && !isSentenceStart(text, t)) w *= MULTIPLIERS.capital;
  if (lang === 'ru' && hasLatin(t.text)) w *= MULTIPLIERS.latinInRu;
  if (letterCount(t.text) >= 7) w *= MULTIPLIERS.long;
  return w;
}

function analyze(text: string, lang: Lang): ScoredToken[] {
  return tokenize(text, lang).map((t, i, all) => {
    const gap = i === 0 ? '' : text.slice(all[i - 1]!.end, t.start);
    return {
      ...t,
      stem: stem(t.text),
      significant: isSignificant(t),
      bridge: isBridge(t.text),
      joinsPrev: i > 0 && /^[\s«»"“”„]*$/u.test(gap),
      score: 0,
    };
  });
}

function candidates(tokens: ScoredToken[]): Candidate[] {
  const out: Candidate[] = [];
  for (let from = 0; from < tokens.length; from++) {
    if (!tokens[from]!.significant) continue;
    for (let to = from; to < tokens.length && to - from < MAX_PHRASE_WORDS; to++) {
      const t = tokens[to]!;
      if (to > from && !t.joinsPrev) break;
      if (!t.significant && !t.bridge) break;
      // Связка допустима только между двумя значимыми словами.
      if (!t.significant) continue;
      const sig = tokens.slice(from, to + 1).filter((x) => x.significant);
      const max = Math.max(...sig.map((x) => x.score));
      if (sig.some((x) => x.score < NEIGHBOR_MIN_SHARE * max)) continue;
      const sum = sig.reduce((a, x) => a + x.score, 0);
      // При равных весах берём последнее слово: в русской именной группе главное слово обычно в конце.
      let best = from;
      for (let k = from; k <= to; k++) if (tokens[k]!.significant && tokens[k]!.score >= tokens[best]!.score) best = k;
      const bridged = sig.length < to - from + 1;
      out.push({ from, to, best, score: (max + NEIGHBOR_GAIN * (sum - max)) * (bridged ? BRIDGE_PENALTY : 1) });
    }
  }
  return out;
}

const wordsOf = (c: Candidate) => c.to - c.from + 1;

function select(tokens: ScoredToken[], cands: Candidate[], target: number, minCount: number, budget: number): Candidate[] {
  const sorted = [...cands].sort((a, b) => b.score - a.score || wordsOf(a) - wordsOf(b) || a.from - b.from);
  const picked: Candidate[] = [];
  const used = new Set<number>();
  const stems = new Set<string>();

  for (const c of sorted) {
    if (picked.length >= target) break;
    // Не пересекаться и не касаться уже выбранной фразы, иначе подсветка сольётся.
    // Соседи через запятую или другой знак касанием не считаются.
    let free = true;
    for (let k = c.from; k <= c.to; k++) if (used.has(k)) free = false;
    if (tokens[c.from]!.joinsPrev && used.has(c.from - 1)) free = false;
    if (tokens[c.to + 1]?.joinsPrev && used.has(c.to + 1)) free = false;
    if (!free) continue;
    const own = tokens.slice(c.from, c.to + 1).filter((t) => t.significant).map((t) => t.stem);
    if (own.every((s) => stems.has(s))) continue;
    picked.push(c);
    for (let k = c.from; k <= c.to; k++) used.add(k);
    own.forEach((s) => stems.add(s));
  }

  const total = () => picked.reduce((a, c) => a + wordsOf(c), 0);

  // Приоритет при конфликте с лимитом 30% (SPEC §5 п.6): сначала укорачиваем фразы
  // до самого весомого слова, начиная с самых слабых, затем отбрасываем лишние сверх минимума.
  const byWeakness = [...picked].sort((a, b) => a.score - b.score);
  for (const c of byWeakness) {
    if (total() <= budget) break;
    if (wordsOf(c) > 1) {
      c.from = c.best;
      c.to = c.best;
      c.score = tokens[c.best]!.score;
    }
  }
  while (total() > budget && picked.length > minCount) {
    let weakest = 0;
    picked.forEach((c, i) => {
      if (c.score < picked[weakest]!.score) weakest = i;
    });
    picked.splice(weakest, 1);
  }

  return picked.sort((a, b) => a.from - b.from);
}

/** Документ-частоты основ: в скольких блоках встречается каждая основа. */
function documentFrequencies(blocks: ScoredToken[][]): Map<string, number> {
  const df = new Map<string, number>();
  for (const tokens of blocks) {
    for (const s of new Set(tokens.filter((t) => t.significant).map((t) => t.stem))) df.set(s, (df.get(s) ?? 0) + 1);
  }
  return df;
}

/**
 * Ключевые фразы для всех блоков документа. idf считается по блокам этого же документа.
 * Возвращает смещения в тексте каждого блока, по порядку в исходнике.
 */
export function extractKeyphrases(blocks: KeywordBlock[], lang?: Lang): Keyphrase[][] {
  const language = lang ?? detectLang(blocks.map((b) => b.text).join(' '));
  const analyzed = blocks.map((b) => analyze(b.text, language));
  const df = documentFrequencies(analyzed);
  const n = blocks.length;

  return analyzed.map((tokens, bi) => {
    const block = blocks[bi]!;
    const tf = new Map<string, number>();
    for (const t of tokens) if (t.significant) tf.set(t.stem, (tf.get(t.stem) ?? 0) + 1);
    for (const t of tokens) {
      if (!t.significant) continue;
      const idf = Math.log((n + 1) / ((df.get(t.stem) ?? 0) + 1)) + 1;
      t.score = tf.get(t.stem)! * idf * tokenWeight(block.text, t, language);
    }

    const words = tokens.length;
    const shortItem = block.kind === 'heading' || (block.kind === 'list-item' && words < SHORT_ITEM_WORDS);
    const minCount = shortItem ? 1 : 3;
    const budget = Math.floor(words * COVER_SHARE);

    const picked = select(tokens, candidates(tokens), targetCount(words), minCount, budget);

    return picked.map((c) => ({
      start: tokens[c.from]!.start,
      end: tokens[c.to]!.end,
    }));
  });
}

/** Текст фраз, удобно для отладки и тестов. */
export const phraseTexts = (text: string, phrases: Keyphrase[]) => phrases.map((p) => text.slice(p.start, p.end));
