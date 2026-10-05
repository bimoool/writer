import type { CheckText, Range } from './checkText';
import { stem } from './stem';
import { isStopword } from './stopwords';
import { collectUnits, lettersOf, type Word } from './textUnits';

/** Читаемость (SPEC §15.2): индекс Флеша в адаптации Оборневой, длинные предложения, длинные слова, повторы. */

export const LONG_SENTENCE_WORDS = 25;
export const LONG_WORD_LETTERS = 12;
export const REPEAT_MIN = 3;
export const REPEAT_WINDOW = 5;
const REPEAT_MIN_LETTERS = 4;
/** Границы оценки словами: от 60 «легко читать», от 30 «средне», ниже «тяжело» (SPEC §15.2). */
export const EASY_FROM = 60;
export const MEDIUM_FROM = 30;

export type ReadingLevel = 'easy' | 'medium' | 'hard';

const VOWELS = /[аеёиоуыэюяaeiouy]/gi;

/** Слоги русского слова по числу гласных. Слово без гласных («в», «к», «ст») слогов не имеет. */
export const countSyllables = (word: string): number => word.match(VOWELS)?.length ?? 0;

/** Индекс удобочитаемости Флеша, адаптация И. В. Оборневой для русского. */
export const fleschOborneva = (wordsPerSentence: number, syllablesPerWord: number): number =>
  206.835 - 1.3 * wordsPerSentence - 60.1 * syllablesPerWord;

export const levelOf = (score: number): ReadingLevel => (score >= EASY_FROM ? 'easy' : score >= MEDIUM_FROM ? 'medium' : 'hard');

export interface LongSentence extends Range {
  words: number;
}

export interface RepeatGroup {
  word: string;
  count: number;
  /** Сколько предложений занимает повтор (от первого до последнего включительно). */
  span: number;
  occurrences: Range[];
}

export interface Readability {
  words: number;
  sentences: number;
  wordsPerSentence: number;
  syllablesPerWord: number;
  /** Индекс Флеша; null, если слов или предложений нет. */
  score: number | null;
  level: ReadingLevel | null;
  longWordShare: number;
  longSentences: LongSentence[];
  repeats: RepeatGroup[];
}

/** Повторы значимых слов: три и более раза в пределах пяти предложений. Слова сравниваются по основе. */
export function findRepeats(words: Word[]): RepeatGroup[] {
  const byStem = new Map<string, Word[]>();
  for (const w of words) {
    const letters = lettersOf(w.text);
    if (letters.length < REPEAT_MIN_LETTERS || isStopword(w.text)) continue;
    const key = stem(w.text);
    (byStem.get(key) ?? byStem.set(key, []).get(key)!).push(w);
  }
  const groups: RepeatGroup[] = [];
  for (const occ of byStem.values()) {
    let i = 0;
    while (i < occ.length) {
      let j = i;
      while (j + 1 < occ.length && occ[j + 1]!.sentence - occ[i]!.sentence < REPEAT_WINDOW) j++;
      if (j - i + 1 >= REPEAT_MIN) {
        const slice = occ.slice(i, j + 1);
        groups.push({
          word: slice[0]!.text.toLowerCase(),
          count: slice.length,
          span: slice[slice.length - 1]!.sentence - slice[0]!.sentence + 1,
          occurrences: slice.map((w) => ({ start: w.start, end: w.end })),
        });
        i = j + 1;
      } else i++;
    }
  }
  return groups.sort((a, b) => a.occurrences[0]!.start - b.occurrences[0]!.start);
}

export function analyzeReadability(ct: CheckText): Readability {
  const { words, sentences } = collectUnits(ct);
  const sentenceCount = sentences.length;
  const syllables = words.reduce((sum, w) => sum + countSyllables(w.text), 0);
  const wordsPerSentence = sentenceCount ? words.length / sentenceCount : 0;
  const syllablesPerWord = words.length ? syllables / words.length : 0;
  const score = words.length && sentenceCount ? fleschOborneva(wordsPerSentence, syllablesPerWord) : null;
  const longWords = words.filter((w) => lettersOf(w.text).length > LONG_WORD_LETTERS).length;
  const longSentences: LongSentence[] = sentences
    .filter((s) => s.words > LONG_SENTENCE_WORDS)
    .map((s) => ({ start: s.start, end: s.end, words: s.words }));
  return {
    words: words.length,
    sentences: sentenceCount,
    wordsPerSentence,
    syllablesPerWord,
    score,
    level: score === null ? null : levelOf(score),
    longWordShare: words.length ? longWords / words.length : 0,
    longSentences,
    repeats: findRepeats(words),
  };
}
