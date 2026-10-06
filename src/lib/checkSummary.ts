import type { CompareResult } from './compare';
import type { Finding, PatternsAnalysis } from './findings';
import type { Readability, ReadingLevel } from './readability';

/** Сводка в начале панели «Проверить текст» (SPEC §15.4): по строке на каждую вкладку. Чистые числа, строки собирает интерфейс. */

export interface CheckSummary {
  read: { level: ReadingLevel; score: number } | { level: null; words: number; sentences: number };
  patterns: { total: number; cliche: number; junk: number; rhythm: number; openings: number; diversity: number };
  compare: { status: CompareResult['status']; phrases: number; patterns: number };
}

export function summarizeCheck(r: Readability, a: PatternsAnalysis, c: CompareResult, ai: Finding[]): CheckSummary {
  const cliche = a.rules.filter((f) => f.category === 'cliche').length;
  const junk = a.rules.filter((f) => f.category === 'junk').length;
  const rhythm = a.rhythm.status === 'tooShort' ? 0 : a.rhythm.chains.length;
  // Одинаковые начала считаем группами (как в списке вкладки), а не каждым началом.
  const openings = new Set(ai.filter((f) => f.sub === 'start').map((f) => (f.sub === 'start' ? `${f.scope}:${f.key}:${f.count}` : ''))).size;
  const diversity = a.diversity.windows.filter((w) => w.low).length;
  return {
    read: r.score === null || r.level === null ? { level: null, words: r.words, sentences: r.sentences } : { level: r.level, score: r.score },
    patterns: { total: cliche + junk + rhythm + openings + diversity, cliche, junk, rhythm, openings, diversity },
    compare: { status: c.status, phrases: c.phrases.length, patterns: c.carriedPatterns.length },
  };
}
