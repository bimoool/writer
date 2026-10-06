import { findPatterns } from './aiCheck';
import { buildSourceCheckText, type CheckPart, type Range } from './checkText';
import { analyzeRhythm } from './rhythm';

/**
 * Шаблонные места исходника (SPEC §3.2, §15.7). Считается локально и один раз на документ, сразу при открытии Split:
 * это единственное исключение из правила «проверка только по кнопке». Наружу ничего не уходит, текст не меняется.
 */

export type TemplateKind = 'cliche' | 'junk' | 'rhythm';

export interface TemplateSpot extends Range {
  kind: TemplateKind;
}

export interface SourceTemplates {
  counts: Record<TemplateKind, number> & { total: number };
  spots: TemplateSpot[];
  /** Куски исходника, по которым считали (для раскладки подсветки по блокам). */
  parts: CheckPart[];
}

interface SourceBlock {
  id: string;
  paragraphIndex: number;
  kind: 'text' | 'heading' | 'list-item';
  sourceText: string;
}

export function analyzeSourceTemplates(blocks: SourceBlock[]): SourceTemplates {
  const ct = buildSourceCheckText(blocks.map((b) => ({ ...b, userText: '' })));
  const spots: TemplateSpot[] = findPatterns(ct).map((f) => ({ kind: f.category, start: f.start, end: f.end }));
  const rhythm = analyzeRhythm(ct);
  // Короткий текст ритм не оценивает (RHYTHM.minSentences): цепочки из него не считаем.
  if (rhythm.status !== 'tooShort') for (const c of rhythm.chains) spots.push({ kind: 'rhythm', start: c.start, end: c.end });
  const counts = { cliche: 0, junk: 0, rhythm: 0, total: 0 };
  for (const s of spots) {
    counts[s.kind]++;
    counts.total++;
  }
  return { counts, spots: spots.sort((a, b) => a.start - b.start), parts: ct.parts };
}

/** Подсветка в координатах block.sourceText, по id блока. */
export function spotsByBlock(t: SourceTemplates, blocks: Array<{ id: string; sourceText: string }>): Map<string, TemplateSpot[]> {
  const out = new Map<string, TemplateSpot[]>();
  for (const part of t.parts) {
    const block = blocks.find((b) => b.id === part.blockId);
    if (!block) continue;
    const local: TemplateSpot[] = [];
    for (const s of t.spots) {
      const start = Math.max(s.start, part.start);
      const end = Math.min(s.end, part.end);
      if (end > start) local.push({ kind: s.kind, start: start - part.start + part.lead, end: end - part.start + part.lead });
    }
    if (local.length) out.set(part.blockId, local);
  }
  return out;
}

const cache = new Map<string, { key: string; value: SourceTemplates }>();

/**
 * Результат кэшируется в памяти по id документа. Исходник не меняется, но блоки можно пересобрать (смена размера),
 * поэтому в ключе подпись блоков: при той же разбивке повторных вычислений нет.
 */
export function sourceTemplatesFor(docId: string, blocks: SourceBlock[]): SourceTemplates {
  const key = blocks.map((b) => `${b.paragraphIndex}${b.kind}${b.sourceText}`).join('\u0001');
  const hit = cache.get(docId);
  if (hit && hit.key === key) return hit.value;
  const value = analyzeSourceTemplates(blocks);
  cache.set(docId, { key, value });
  return value;
}

export const forgetSourceTemplates = (docId: string) => void cache.delete(docId);

const PRIORITY: Record<TemplateKind, number> = { cliche: 0, junk: 1, rhythm: 2 };

/**
 * Режет отрезок [start, end) по границам подсветки. У каждого куска один вид (при наложении побеждает штамп,
 * затем мусор, затем ритм) или null, если подсветки нет. Куски идут подряд, без пропусков.
 */
export function templatePieces(start: number, end: number, spots: TemplateSpot[]): Array<Range & { kind: TemplateKind | null }> {
  const inside = spots.filter((s) => s.end > start && s.start < end);
  if (!inside.length) return [{ start, end, kind: null }];
  const cuts = [...new Set([start, end, ...inside.flatMap((s) => [s.start, s.end]).filter((x) => x > start && x < end)])].sort((a, b) => a - b);
  const out: Array<Range & { kind: TemplateKind | null }> = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i]!;
    const b = cuts[i + 1]!;
    const kinds = inside.filter((s) => s.start <= a && s.end >= b).map((s) => s.kind);
    const kind = kinds.length ? kinds.reduce((x, y) => (PRIORITY[x] <= PRIORITY[y] ? x : y)) : null;
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.end = b;
    else out.push({ start: a, end: b, kind });
  }
  return out;
}
