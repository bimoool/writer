import type { CheckText, Range } from './checkText';
import { detectLang, tokenize, type Lang } from './tokens';

/** Общая разметка текста для проверок: слова и предложения без заголовков, чисел и ссылок. */

export interface Word extends Range {
  text: string;
  sentence: number;
}

export interface Sentence extends Range {
  /** Номер абзаца среди абзацев проверяемого текста. */
  paragraph: number;
  words: number;
}

export interface Units {
  lang: Lang;
  words: Word[];
  /** Предложения с хотя бы одним словом, заголовки не входят. */
  sentences: Sentence[];
}

const hasLetter = (s: string) => /\p{L}/u.test(s);

export function collectUnits(ct: CheckText): Units {
  const lang = detectLang(ct.text);
  const words: Word[] = [];
  const sentences: Sentence[] = [];
  ct.paragraphs.forEach((p, paragraph) => {
    if (p.kind === 'heading') return;
    for (const s of p.sentences) {
      const index = sentences.length;
      const first = words.length;
      for (const t of tokenize(ct.text.slice(s.start, s.end), lang)) {
        // Числа и ссылки словами не считаются.
        if (!hasLetter(t.text) || /\d/.test(t.text) || /[:/@]/.test(t.text)) continue;
        words.push({ text: t.text, start: t.start + s.start, end: t.end + s.start, sentence: index });
      }
      const n = words.length - first;
      if (n > 0) sentences.push({ start: s.start, end: s.end, paragraph, words: n });
      else words.length = first;
    }
  });
  return { lang, words, sentences };
}

export const lettersOf = (w: string) => w.replace(/[^\p{L}]/gu, '');
