import { findPatterns, type PatternFinding } from './aiCheck';
import type { CheckPart, CheckText, Range } from './checkText';
import { stem } from './stem';
import { isStopword } from './stopwords';
import { tokenize } from './tokens';

/** Сравнение с исходником (SPEC §15.4): шаблоны, перешедшие из исходника, и дословно перенесённые фразы. */

/** Сколько слов подряд считается перенесённой фразой. */
export const CARRY_WORDS = 4;
/** Сколько блоков с наибольшим числом перенесённых фраз отмечается в таблице. */
export const TOP_BLOCKS = 3;

export interface CarriedPattern extends PatternFinding {
  /** Пример совпадения в исходнике. */
  sourceExample: string;
}

export interface GonePattern {
  ruleId: string;
  hint: string;
  category: 'cliche' | 'junk';
  count: number;
  example: string;
}

export interface SourceSpot {
  /** Блок исходника, в котором начинается фраза. */
  blockId: string;
  /** Текст блока исходника (обрезанный) и положение фразы в нём. */
  text: string;
  start: number;
  end: number;
}

export interface CarriedPhrase extends Range {
  words: number;
  source: SourceSpot;
}

export interface CompareResult {
  status: 'ok' | 'noSource' | 'noText';
  carriedPatterns: CarriedPattern[];
  gonePatterns: GonePattern[];
  phrases: CarriedPhrase[];
  /** Блоки пользователя с наибольшим числом перенесённых фраз, от большего к меньшему. */
  topBlocks: Array<{ blockId: string; count: number }>;
}

interface W {
  stem: string;
  stop: boolean;
  start: number;
  end: number;
}

const wordsOf = (ct: CheckText): W[] =>
  tokenize(ct.text)
    .filter((t) => /\p{L}/u.test(t.text) && !/\d/.test(t.text))
    .map((t) => ({ stem: stem(t.text), stop: isStopword(t.text), start: t.start, end: t.end }));

/** Часть, в которую попадает позиция: двоичный поиск, части отсортированы. */
function partOf(parts: CheckPart[], pos: number): CheckPart | undefined {
  let lo = 0;
  let hi = parts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const p = parts[mid]!;
    if (pos < p.start) hi = mid - 1;
    else if (pos >= p.end) lo = mid + 1;
    else return p;
  }
  return undefined;
}

/** Общие подряд идущие n слов (по основам) у исходника и у пользователя: максимальные отрезки, без отрезков из одних стоп-слов. */
export function carriedPhrases(source: CheckText, user: CheckText, minWords = CARRY_WORDS): CarriedPhrase[] {
  const s = wordsOf(source);
  const u = wordsOf(user);
  if (s.length < minWords || u.length < minWords) return [];
  const gram = (w: W[], i: number) => w.slice(i, i + minWords).map((x) => x.stem).join(' ');
  const seen = new Map<string, number>();
  for (let i = 0; i + minWords <= s.length; i++) {
    const g = gram(s, i);
    if (!seen.has(g)) seen.set(g, i);
  }
  // Для каждого слова пользователя: позиция в исходнике, с которой начинается совпавшее окно.
  const hit: Array<number | undefined> = Array(u.length).fill(undefined);
  for (let i = 0; i + minWords <= u.length; i++) {
    const at = seen.get(gram(u, i));
    if (at !== undefined) hit[i] = at;
  }
  const out: CarriedPhrase[] = [];
  let i = 0;
  while (i < u.length) {
    if (hit[i] === undefined) {
      i++;
      continue;
    }
    const first = i;
    let last = i + minWords - 1;
    // Окна, идущие подряд (с шагом в одно слово), сливаются в одну фразу.
    while (i + 1 < u.length && hit[i + 1] !== undefined && hit[i + 1] === hit[i]! + 1) {
      i++;
      last = i + minWords - 1;
    }
    i++;
    if (u.slice(first, last + 1).every((w) => w.stop)) continue;
    const range = { start: u[first]!.start, end: u[last]!.end };
    const part = partOf(source.parts, s[hit[first]!]!.start);
    if (!part) continue;
    const text = source.text.slice(part.start, part.end);
    const from = s[hit[first]!]!.start - part.start;
    const srcLast = Math.min(s[hit[first]! + (last - first)]?.end ?? part.end, part.end);
    out.push({ ...range, words: last - first + 1, source: { blockId: part.blockId, text, start: from, end: srcLast - part.start } });
  }
  return out;
}

const sample = (ct: CheckText, f: Range) => ct.text.slice(f.start, f.end);

/** Правила, сработавшие в обоих текстах, и только в исходнике. */
export function comparePatterns(source: CheckText, user: CheckText): Pick<CompareResult, 'carriedPatterns' | 'gonePatterns'> {
  const inSource = findPatterns(source);
  const inUser = findPatterns(user);
  const userIds = new Set(inUser.map((f) => f.ruleId));
  const firstInSource = new Map<string, PatternFinding>();
  const count = new Map<string, number>();
  for (const f of inSource) {
    if (!firstInSource.has(f.ruleId)) firstInSource.set(f.ruleId, f);
    count.set(f.ruleId, (count.get(f.ruleId) ?? 0) + 1);
  }
  return {
    carriedPatterns: inUser.filter((f) => firstInSource.has(f.ruleId)).map((f) => ({ ...f, sourceExample: sample(source, firstInSource.get(f.ruleId)!) })),
    gonePatterns: [...firstInSource.values()]
      .filter((f) => !userIds.has(f.ruleId))
      .map((f) => ({ ruleId: f.ruleId, hint: f.hint, category: f.category, count: count.get(f.ruleId)!, example: sample(source, f) })),
  };
}

export function compareTexts(source: CheckText, user: CheckText): CompareResult {
  const empty = { carriedPatterns: [], gonePatterns: [], phrases: [], topBlocks: [] };
  if (!source.text.trim()) return { status: 'noSource', ...empty };
  if (!user.text.trim()) return { status: 'noText', ...empty };
  const patterns = comparePatterns(source, user);
  const phrases = carriedPhrases(source, user);
  const perBlock = new Map<string, number>();
  for (const p of phrases) {
    const part = partOf(user.parts, p.start);
    if (part) perBlock.set(part.blockId, (perBlock.get(part.blockId) ?? 0) + 1);
  }
  const topBlocks = [...perBlock.entries()]
    .map(([blockId, count]) => ({ blockId, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_BLOCKS);
  return { status: 'ok', ...patterns, phrases, topBlocks };
}
