import { OPENINGS } from './aiPatterns';
import type { CheckText, Range } from './checkText';
import { isBridge } from './stopwords';
import { collectUnits, type Word } from './textUnits';
import { normalize, tokenize } from './tokens';

/** Одинаковые начала предложений и абзацев (SPEC §15.3). */

export interface OpeningGroup {
  /** Само начало (слово или пара слов) в нижнем регистре. */
  key: string;
  scope: 'sentences' | 'paragraphs';
  /** Начала, которые подсвечиваются: диапазоны первых слов каждого предложения или абзаца группы. */
  starts: Range[];
}

/** Начало из слов предложения: первые words слов после предлогов и союзов. null, если слов нет. */
function openingOfWords(words: Word[], n = OPENINGS.startWords): { key: string; range: Range } | null {
  const content: Word[] = [];
  for (const w of words) {
    if (content.length === 0 && isBridge(w.text)) continue;
    content.push(w);
    if (content.length === n) break;
  }
  if (content.length < n) return null;
  return { key: content.map((w) => normalize(w.text)).join(' '), range: { start: content[0]!.start, end: content[content.length - 1]!.end } };
}

/** Начало текста: первые words слов после предлогов и союзов. null, если слов нет. */
export function openingOf(text: string, offset: number, words = OPENINGS.startWords): { key: string; range: Range } | null {
  const tokens = tokenize(text)
    .filter((t) => /\p{L}/u.test(t.text) && !/\d/.test(t.text))
    .map((t, i) => ({ text: t.text, start: offset + t.start, end: offset + t.end, sentence: i }));
  return openingOfWords(tokens, words);
}

/** Серии подряд идущих элементов с одним ключом длиной от run. */
function runs<T extends { key: string | null }>(items: T[], run: number): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  for (const it of items) {
    if (it.key !== null && cur.length && cur[0]!.key === it.key) cur.push(it);
    else {
      if (cur.length >= run) out.push(cur);
      cur = it.key !== null ? [it] : [];
    }
  }
  if (cur.length >= run) out.push(cur);
  return out;
}

export function findOpenings(ct: CheckText): OpeningGroup[] {
  const { sentences, words } = collectUnits(ct);
  const groups: OpeningGroup[] = [];

  // Слова предложения: слова идут по порядку, поэтому у каждого предложения это непрерывный отрезок.
  const firstWord: number[] = [];
  words.forEach((w, i) => {
    if (firstWord[w.sentence] === undefined) firstWord[w.sentence] = i;
  });

  // Предложения подряд, внутри одного абзаца.
  const items = sentences.map((s, i) => {
    const from = firstWord[i] ?? words.length;
    const o = openingOfWords(words.slice(from, from + s.words));
    return { key: o?.key ?? null, range: o?.range ?? null, paragraph: s.paragraph };
  });
  const byParagraph = new Map<number, typeof items>();
  for (const it of items) byParagraph.set(it.paragraph, [...(byParagraph.get(it.paragraph) ?? []), it]);
  for (const list of byParagraph.values()) {
    for (const r of runs(list, OPENINGS.run)) groups.push({ key: r[0]!.key!, scope: 'sentences', starts: r.map((x) => x.range!) });
  }

  // Абзацы подряд. Заголовки и пункты списка не в счёт: списки по природе начинаются одинаково.
  const firstOfParagraph = new Map<number, (typeof items)[number]>();
  items.forEach((it) => {
    if (!firstOfParagraph.has(it.paragraph)) firstOfParagraph.set(it.paragraph, it);
  });
  const paragraphs = ct.paragraphs.flatMap((p, i) => {
    if (p.kind !== 'text') return [];
    const first = firstOfParagraph.get(i);
    return [{ key: first?.key ?? null, range: first?.range ?? null }];
  });
  for (const r of runs(paragraphs, OPENINGS.run)) groups.push({ key: r[0]!.key!, scope: 'paragraphs', starts: r.map((x) => x.range!) });

  return groups.sort((a, b) => a.starts[0]!.start - b.starts[0]!.start);
}
