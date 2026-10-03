import { stem } from './stem';
import { tokenize, type Lang } from './tokens';
import type { Block } from './types';

/** Метрики итога (SPEC §9). */

export function stemSequence(text: string, lang?: Lang): string[] {
  return tokenize(text, lang).map((t) => stem(t.text));
}

export function trigrams(stems: string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 2 < stems.length; i++) out.add(`${stems[i]} ${stems[i + 1]} ${stems[i + 2]}`);
  return out;
}

/**
 * «Свои слова» = 1 − |общие 3-граммы основ| / |3-граммы основ пользователя| по всему документу.
 * Возвращает долю 0..1 или null, если пользователь написал меньше трёх слов.
 */
export function ownWords(sourceTexts: string[], userTexts: string[], lang?: Lang): number | null {
  const src = new Set<string>();
  const usr = new Set<string>();
  for (const t of sourceTexts) trigrams(stemSequence(t, lang)).forEach((g) => src.add(g));
  for (const t of userTexts) trigrams(stemSequence(t, lang)).forEach((g) => usr.add(g));
  if (usr.size === 0) return null;
  let common = 0;
  for (const g of usr) if (src.has(g)) common++;
  return 1 - common / usr.size;
}

export const toPercent = (share: number | null) => (share === null ? null : Math.round(share * 100));

export interface ResultMetrics {
  activeMs: number;
  wordsWritten: number;
  opens: { 1: number; 2: number; 3: number };
  peeks: number;
  peekMs: number;
  /** Доля набранного вручную, 0..1; null, если ничего не набрано и не вставлено. */
  typedShare: number | null;
  ownWords: number | null;
}

export function computeMetrics(blocks: Block[], lang?: Lang): ResultMetrics {
  const opens = { 1: 0, 2: 0, 3: 0 };
  let activeMs = 0;
  let wordsWritten = 0;
  let peeks = 0;
  let peekMs = 0;
  let typed = 0;
  let pasted = 0;
  for (const b of blocks) {
    activeMs += b.activeMs;
    wordsWritten += tokenize(b.userText, lang).length;
    opens[1] += b.hints.opens[1];
    opens[2] += b.hints.opens[2];
    opens[3] += b.hints.opens[3];
    peeks += b.hints.peeks;
    peekMs += b.hints.peekMs;
    typed += b.typedChars;
    pasted += b.pastedChars;
  }
  return {
    activeMs,
    wordsWritten,
    opens,
    peeks,
    peekMs,
    typedShare: typed + pasted === 0 ? null : typed / (typed + pasted),
    ownWords: ownWords(
      blocks.map((b) => b.sourceText),
      blocks.map((b) => b.userText),
      lang,
    ),
  };
}
