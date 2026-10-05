import { RHYTHM } from './aiPatterns';
import type { CheckText, Range } from './checkText';
import { collectUnits } from './textUnits';

/** Ритм предложений (SPEC §15.3): разброс длины и цепочки почти одинаковых по длине предложений. */

export interface EvenRule {
  run: number;
  maxDiff: number;
  minWords: number;
}

export interface Chain {
  /** Индексы первого и последнего предложения цепочки (включительно). */
  from: number;
  to: number;
}

/**
 * Цепочки подряд идущих предложений почти одной длины. Окно из run предложений «ровное», если все не короче minWords
 * и разница между самым длинным и самым коротким меньше maxDiff от самого длинного. Пересекающиеся окна сливаются в одну цепочку.
 * Общая функция: её же использует вкладка «Шаблоны» для ритма.
 */
export function evenChains(lengths: number[], rule: EvenRule = RHYTHM): Chain[] {
  const chains: Chain[] = [];
  for (let i = 0; i + rule.run <= lengths.length; i++) {
    const w = lengths.slice(i, i + rule.run);
    const min = Math.min(...w);
    const max = Math.max(...w);
    if (min < rule.minWords || (max - min) / max >= rule.maxDiff) continue;
    const to = i + rule.run - 1;
    const last = chains[chains.length - 1];
    if (last && i <= last.to) last.to = to;
    else chains.push({ from: i, to });
  }
  return chains;
}

export interface LengthStats {
  mean: number;
  sd: number;
  /** Коэффициент вариации: sd / mean. */
  cv: number;
}

export function lengthStats(lengths: number[]): LengthStats {
  if (lengths.length === 0) return { mean: 0, sd: 0, cv: 0 };
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const sd = Math.sqrt(lengths.reduce((a, b) => a + (b - mean) ** 2, 0) / lengths.length);
  return { mean, sd, cv: mean ? sd / mean : 0 };
}

export interface ChainSpan extends Range {
  count: number;
  words: number[];
}

export interface RhythmResult {
  status: 'tooShort' | 'even' | 'lively';
  sentences: number;
  stats: LengthStats;
  chains: ChainSpan[];
}

export function analyzeRhythm(ct: CheckText): RhythmResult {
  const { sentences } = collectUnits(ct);
  const stats = lengthStats(sentences.map((s) => s.words));
  const chains: ChainSpan[] = [];
  // Цепочки ищем внутри абзаца: на границе абзацев ритм начинается заново.
  const byParagraph = new Map<number, number[]>();
  sentences.forEach((s, i) => byParagraph.set(s.paragraph, [...(byParagraph.get(s.paragraph) ?? []), i]));
  for (const idx of byParagraph.values()) {
    for (const c of evenChains(idx.map((i) => sentences[i]!.words))) {
      const first = sentences[idx[c.from]!]!;
      const last = sentences[idx[c.to]!]!;
      chains.push({ start: first.start, end: last.end, count: c.to - c.from + 1, words: idx.slice(c.from, c.to + 1).map((i) => sentences[i]!.words) });
    }
  }
  const status = sentences.length < RHYTHM.minSentences ? 'tooShort' : stats.cv < RHYTHM.cvEven ? 'even' : 'lively';
  return { status, sentences: sentences.length, stats, chains };
}
