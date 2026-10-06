import { findPatternsSteps } from './aiCheck';
import { buildSourceCheckTextSteps, type CheckPart, type Range } from './checkText';
import { analyzeRhythm } from './rhythm';
import { drain, runSliced, type Steps } from './slice';
import { collectUnitsSteps } from './textUnits';

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

export const analyzeSourceTemplates = (blocks: SourceBlock[]): SourceTemplates => drain(analyzeSourceTemplatesSteps(blocks));

/** Расчёт порциями: сборка текста, разметка слов, правила по одному, ритм (SPEC §15.7). */
export function* analyzeSourceTemplatesSteps(blocks: SourceBlock[]): Steps<SourceTemplates> {
  const ct = yield* buildSourceCheckTextSteps(blocks.map((b) => ({ ...b, userText: '' })));
  yield* collectUnitsSteps(ct);
  const spots: TemplateSpot[] = (yield* findPatternsSteps(ct)).map((f) => ({ kind: f.category, start: f.start, end: f.end }));
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

const keyOf = (blocks: SourceBlock[]) => blocks.map((b) => `${b.paragraphIndex}${b.kind}${b.sourceText}`).join('\u0001');

/** Исходник такого размера (знаков) считается сразу, без «считаем…»: на нём расчёт короче одной порции. */
export const SYNC_SOURCE_CHARS = 30_000;

/** Готовый результат из кэша или null. Ключом служит подпись блоков: смена размера блоков пересчитывает результат. */
export function cachedSourceTemplates(docId: string, blocks: SourceBlock[]): SourceTemplates | null {
  const hit = cache.get(docId);
  return hit && hit.key === keyOf(blocks) ? hit.value : null;
}

const measured = <T>(f: () => T): T => {
  const t0 = performance.now();
  const value = f();
  mark(t0);
  return value;
};

/** Замер для e2e/perf-big.cjs: имя check:src-templates в Performance API (сумма времени порций, без пауз между ними). */
function mark(start: number) {
  try {
    performance.measure('check:src-templates', { start, end: performance.now() });
  } catch {
    /* Performance API недоступен */
  }
}

/** Результат сразу: из кэша или вычислением целиком. Для небольших исходников и тестов. */
export function sourceTemplatesFor(docId: string, blocks: SourceBlock[]): SourceTemplates {
  const hit = cachedSourceTemplates(docId, blocks);
  if (hit) return hit;
  const value = measured(() => analyzeSourceTemplates(blocks));
  cache.set(docId, { key: keyOf(blocks), value });
  return value;
}

/** Результат порциями, не блокируя интерфейс дольше одной порции. Отмена: signal. Результат попадает в тот же кэш. */
export async function sourceTemplatesAsync(docId: string, blocks: SourceBlock[], signal?: AbortSignal): Promise<SourceTemplates> {
  const hit = cachedSourceTemplates(docId, blocks);
  if (hit) return hit;
  const key = keyOf(blocks);
  const t0 = performance.now();
  const value = await runSliced(analyzeSourceTemplatesSteps(blocks), signal);
  // Полное время от начала до конца вместе с паузами: в замере видно и сколько реально считали, и сколько ждали.
  mark(t0);
  cache.set(docId, { key, value });
  return value;
}

export const sourceChars = (blocks: SourceBlock[]) => blocks.reduce((n, b) => n + b.sourceText.length, 0);

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
