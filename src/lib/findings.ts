import type { PatternFinding } from './aiCheck';
import type { CheckPart, Range } from './checkText';
import type { CompareResult, SourceSpot } from './compare';
import type { DiversityResult } from './diversity';
import type { OpeningGroup } from './openings';
import type { Readability } from './readability';
import type { RhythmResult } from './rhythm';

/** Найденные места в общем виде: для подсветки в тексте и для карточки с пояснением (SPEC §15.5). */

/** Вкладка панели, к которой относится находка. */
export type FindingKind = 'read' | 'ai' | 'cmp';
/** Цвет подсветки (токены --mark-*). */
export type Tone = 'read' | 'ai' | 'junk' | 'carry';

export type FindingData =
  | { kind: 'read'; sub: 'long'; words: number }
  | { kind: 'read'; sub: 'repeat'; word: string; count: number; span: number }
  | { kind: 'ai'; sub: 'rule'; ruleId: string; hint: string; advice?: string; category: 'cliche' | 'junk'; group?: string; detail?: PatternFinding['detail'] }
  | { kind: 'ai'; sub: 'rhythm'; count: number; words: number[] }
  | { kind: 'ai'; sub: 'start'; key: string; scope: 'sentences' | 'paragraphs'; count: number }
  | { kind: 'ai'; sub: 'diversity'; ratio: number; mean: number; top: Array<{ word: string; count: number }> }
  | { kind: 'cmp'; sub: 'pattern'; ruleId: string; hint: string; sourceExample: string }
  | { kind: 'cmp'; sub: 'phrase'; words: number; source: SourceSpot };

export type Finding = Range & { id: string; tone: Tone } & FindingData;

export function readFindings(r: Readability): Finding[] {
  const out: Finding[] = r.longSentences.map((s) => ({ id: `read:long:${s.start}`, kind: 'read', sub: 'long', tone: 'read', words: s.words, start: s.start, end: s.end }));
  for (const g of r.repeats) {
    for (const o of g.occurrences) {
      out.push({ id: `read:repeat:${o.start}`, kind: 'read', sub: 'repeat', tone: 'read', word: g.word, count: g.count, span: g.span, start: o.start, end: o.end });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

export interface PatternsAnalysis {
  rules: PatternFinding[];
  rhythm: RhythmResult;
  openings: OpeningGroup[];
  diversity: DiversityResult;
}

export function patternFindings(a: PatternsAnalysis): Finding[] {
  const out: Finding[] = a.rules.map((f) => ({
    id: `ai:rule:${f.ruleId}:${f.start}`,
    kind: 'ai',
    sub: 'rule',
    tone: f.category === 'junk' ? 'junk' : 'ai',
    ruleId: f.ruleId,
    hint: f.hint,
    advice: f.advice,
    category: f.category,
    group: f.group,
    detail: f.detail,
    start: f.start,
    end: f.end,
  }));
  for (const c of a.rhythm.chains) {
    out.push({ id: `ai:rhythm:${c.start}`, kind: 'ai', sub: 'rhythm', tone: 'ai', count: c.count, words: c.words, start: c.start, end: c.end });
  }
  for (const g of a.openings) {
    for (const s of g.starts) out.push({ id: `ai:start:${s.start}`, kind: 'ai', sub: 'start', tone: 'ai', key: g.key, scope: g.scope, count: g.starts.length, start: s.start, end: s.end });
  }
  for (const w of a.diversity.windows) {
    if (w.low) out.push({ id: `ai:div:${w.start}`, kind: 'ai', sub: 'diversity', tone: 'ai', ratio: w.ratio, mean: a.diversity.mean, top: w.top, start: w.start, end: w.end });
  }
  return out.sort((x, y) => x.start - y.start || x.end - y.end);
}

export function compareFindings(c: CompareResult): Finding[] {
  const out: Finding[] = c.carriedPatterns.map((f) => ({
    id: `cmp:pattern:${f.ruleId}:${f.start}`,
    kind: 'cmp',
    sub: 'pattern',
    tone: 'carry',
    ruleId: f.ruleId,
    hint: f.hint,
    sourceExample: f.sourceExample,
    start: f.start,
    end: f.end,
  }));
  for (const p of c.phrases) out.push({ id: `cmp:phrase:${p.start}`, kind: 'cmp', sub: 'phrase', tone: 'carry', words: p.words, source: p.source, start: p.start, end: p.end });
  return out.sort((x, y) => x.start - y.start);
}

/** Находки по блокам: каждая находка попадает в блоки, которые она пересекает. Части отсортированы и не пересекаются. */
export function bucketFindings(parts: CheckPart[], findings: Finding[]): Map<string, Finding[]> {
  const out = new Map<string, Finding[]>();
  for (const f of findings) {
    // Первая часть, конец которой правее начала находки.
    let lo = 0;
    let hi = parts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (parts[mid]!.end <= f.start) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < parts.length && parts[i]!.start < f.end; i++) {
      const id = parts[i]!.blockId;
      const list = out.get(id);
      if (list) list.push(f);
      else out.set(id, [f]);
    }
  }
  return out;
}

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
