import type { CheckPart, CheckText, Range } from './checkText';
import type { PatternFinding } from './aiCheck';
import type { Readability } from './readability';
import { spellCandidates } from './spell';

/** Найденные места в общем виде: для подсветки в тексте и для карточки с пояснением (SPEC §15.4). */

export type FindingKind = 'spell' | 'read' | 'ai';

export type FindingData =
  | { kind: 'spell'; word: string }
  | { kind: 'read'; sub: 'long'; words: number }
  | { kind: 'read'; sub: 'repeat'; word: string; count: number; span: number }
  | { kind: 'ai'; ruleId: string; hint: string; detail?: PatternFinding['detail'] };

export type Finding = Range & { id: string } & FindingData;

export const spellFindings = (ct: CheckText, bad: ReadonlySet<string>): Finding[] =>
  spellCandidates(ct.text)
    .filter((c) => bad.has(c.word))
    .map((c) => ({ id: `spell:${c.start}`, kind: 'spell', word: c.word, start: c.start, end: c.end }));

export function readFindings(r: Readability): Finding[] {
  const out: Finding[] = r.longSentences.map((s) => ({ id: `read:long:${s.start}`, kind: 'read', sub: 'long', words: s.words, start: s.start, end: s.end }));
  for (const g of r.repeats) {
    for (const o of g.occurrences) {
      out.push({ id: `read:repeat:${o.start}`, kind: 'read', sub: 'repeat', word: g.word, count: g.count, span: g.span, start: o.start, end: o.end });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

export const aiFindings = (list: PatternFinding[]): Finding[] =>
  list.map((f) => ({ id: `ai:${f.ruleId}:${f.start}`, kind: 'ai', ruleId: f.ruleId, hint: f.hint, detail: f.detail, start: f.start, end: f.end }));

export interface MarkSegment extends Range {
  /** Находки, накрывающие отрезок: сначала самая узкая (самая конкретная). */
  ids: string[];
}

/**
 * Отрезки текста блока (в координатах обрезанного userText), которые надо подсветить. Пересекающиеся находки делят
 * границы: на каждом отрезке известно, какие находки его накрывают.
 */
export function markSegments(part: CheckPart, findings: Finding[]): MarkSegment[] {
  const local = findings
    .map((f) => ({ f, start: Math.max(f.start, part.start), end: Math.min(f.end, part.end) }))
    .filter((x) => x.end > x.start);
  const cuts = [...new Set(local.flatMap((x) => [x.start, x.end]))].sort((a, b) => a - b);
  const out: MarkSegment[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const start = cuts[i]!;
    const end = cuts[i + 1]!;
    const cover = local.filter((x) => x.start <= start && x.end >= end).sort((a, b) => a.f.end - a.f.start - (b.f.end - b.f.start));
    if (cover.length) out.push({ start: start - part.start, end: end - part.start, ids: cover.map((x) => x.f.id) });
  }
  return out;
}

