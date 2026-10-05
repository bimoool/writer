import { DIVERSITY } from './aiPatterns';
import type { CheckText, Range } from './checkText';
import { stem } from './stem';
import { isStopword } from './stopwords';
import { collectUnits, lettersOf } from './textUnits';

/** Разнообразие слов (SPEC §15.3): доля уникальных основ среди значимых слов по окнам. */

export interface DiversityWindow extends Range {
  /** Доля уникальных основ в окне, 0..1. */
  ratio: number;
  words: number;
  low: boolean;
  /** Слова, повторяющиеся в окне чаще всего (только повторившиеся). */
  top: Array<{ word: string; count: number }>;
}

export interface DiversityResult {
  status: 'tooShort' | 'ok';
  significant: number;
  mean: number;
  windows: DiversityWindow[];
}

export function analyzeDiversity(ct: CheckText): DiversityResult {
  const sig = collectUnits(ct).words.filter((w) => lettersOf(w.text).length >= DIVERSITY.minLetters && !isStopword(w.text));
  if (sig.length < DIVERSITY.window) return { status: 'tooShort', significant: sig.length, mean: 0, windows: [] };
  const count = Math.floor(sig.length / DIVERSITY.window);
  const windows: DiversityWindow[] = [];
  for (let k = 0; k < count; k++) {
    const part = sig.slice(Math.floor((k * sig.length) / count), Math.floor(((k + 1) * sig.length) / count));
    const byStem = new Map<string, { word: string; count: number }>();
    for (const w of part) {
      const key = stem(w.text);
      const e = byStem.get(key);
      if (e) e.count++;
      else byStem.set(key, { word: w.text.toLowerCase(), count: 1 });
    }
    windows.push({
      start: part[0]!.start,
      end: part[part.length - 1]!.end,
      words: part.length,
      ratio: byStem.size / part.length,
      low: false,
      top: [...byStem.values()]
        .filter((e) => e.count > 1)
        .sort((a, b) => b.count - a.count)
        .slice(0, DIVERSITY.topWords),
    });
  }
  const mean = windows.reduce((a, w) => a + w.ratio, 0) / windows.length;
  for (const w of windows) w.low = windows.length > 1 && mean - w.ratio > DIVERSITY.lowBy;
  return { status: 'ok', significant: sig.length, mean, windows };
}
