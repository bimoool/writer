import { OPENINGS } from './aiPatterns';
import type { CheckText, Range } from './checkText';
import { isBridge } from './stopwords';
import { collectUnits } from './textUnits';
import { normalize, tokenize } from './tokens';

/** Одинаковые начала предложений и абзацев (SPEC §15.3). */

export interface OpeningGroup {
  /** Само начало (слово или пара слов) в нижнем регистре. */
  key: string;
  scope: 'sentences' | 'paragraphs';
  /** Начала, которые подсвечиваются: диапазоны первых слов каждого предложения или абзаца группы. */
  starts: Range[];
}

/** Начало текста: первые words слов после предлогов и союзов. null, если слов нет. */
export function openingOf(text: string, offset: number, words = OPENINGS.startWords): { key: string; range: Range } | null {
  const tokens = tokenize(text).filter((t) => /\p{L}/u.test(t.text) && !/\d/.test(t.text));
  const content = [];
  for (const t of tokens) {
    if (content.length === 0 && isBridge(t.text)) continue;
    content.push(t);
    if (content.length === words) break;
  }
  if (content.length < words) return null;
  return {
    key: content.map((t) => normalize(t.text)).join(' '),
    range: { start: offset + content[0]!.start, end: offset + content[content.length - 1]!.end },
  };
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
  const { sentences } = collectUnits(ct);
  const groups: OpeningGroup[] = [];

  // Предложения подряд, внутри одного абзаца.
  const items = sentences.map((s) => {
    const o = openingOf(ct.text.slice(s.start, s.end), s.start);
    return { key: o?.key ?? null, range: o?.range ?? null, paragraph: s.paragraph };
  });
  const byParagraph = new Map<number, typeof items>();
  for (const it of items) byParagraph.set(it.paragraph, [...(byParagraph.get(it.paragraph) ?? []), it]);
  for (const list of byParagraph.values()) {
    for (const r of runs(list, OPENINGS.run)) groups.push({ key: r[0]!.key!, scope: 'sentences', starts: r.map((x) => x.range!) });
  }

  // Абзацы подряд. Заголовки и пункты списка не в счёт: списки по природе начинаются одинаково.
  const paragraphs = ct.paragraphs
    .filter((p) => p.kind === 'text')
    .map((p) => {
      const o = openingOf(ct.text.slice(p.start, p.end), p.start);
      return { key: o?.key ?? null, range: o?.range ?? null };
    });
  for (const r of runs(paragraphs, OPENINGS.run)) groups.push({ key: r[0]!.key!, scope: 'paragraphs', starts: r.map((x) => x.range!) });

  return groups.sort((a, b) => a.starts[0]!.start - b.starts[0]!.start);
}
