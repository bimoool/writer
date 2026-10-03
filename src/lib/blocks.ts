import { buildBlocks, emptyHints } from './doc';
import { topUpKeyphrases } from './keywords';
import { sentences } from './segment';
import { detectLang, tokenize, type Lang } from './tokens';
import type { Block, BlockSize, Doc, Keyphrase } from './types';

/** Ручная правка разбивки на экране Split (SPEC §3.2): ключевые фразы, склейка, разрез, смена размера. */

// --- ключевые фразы -------------------------------------------------------------------------

/**
 * Расширяет выделение до границ слов: любое слово, которого коснулось выделение, входит целиком.
 * Пробелы по краям отбрасываются, знаки препинания по краям в фразу не попадают.
 * Возвращает null, если в выделении нет ни одного слова.
 */
export function snapToWords(text: string, start: number, end: number, lang: Lang = detectLang(text)): Keyphrase | null {
  let s = Math.max(0, Math.min(start, end));
  let e = Math.min(text.length, Math.max(start, end));
  while (s < e && /\s/.test(text[s]!)) s++;
  while (e > s && /\s/.test(text[e - 1]!)) e--;
  if (e <= s) return null;

  const hit = tokenize(text, lang).filter((t) => t.end > s && t.start < e);
  if (hit.length === 0) return null;
  return { start: hit[0]!.start, end: hit[hit.length - 1]!.end };
}

export type AddKeyphraseResult = { ok: true; phrases: Keyphrase[] } | { ok: false; reason: 'empty' | 'overlap' };

const overlaps = (a: Keyphrase, b: Keyphrase) => a.start < b.end && a.end > b.start;

/** Добавляет фразу по выделению. Пересечение с уже существующей фразой не допускается. */
export function addKeyphrase(phrases: Keyphrase[], text: string, start: number, end: number, lang?: Lang): AddKeyphraseResult {
  const snapped = snapToWords(text, start, end, lang);
  if (!snapped) return { ok: false, reason: 'empty' };
  if (phrases.some((p) => overlaps(p, snapped))) return { ok: false, reason: 'overlap' };
  return { ok: true, phrases: [...phrases, snapped].sort((a, b) => a.start - b.start) };
}

export const removeKeyphraseAt = (phrases: Keyphrase[], index: number): Keyphrase[] => phrases.filter((_, i) => i !== index);

// --- разрез ---------------------------------------------------------------------------------

export interface Gap {
  /** Пробелы между предложениями: [start, end). */
  start: number;
  end: number;
}

/**
 * Места, где можно разрезать блок: промежутки между соседними предложениями.
 * Промежуток внутри ключевой фразы (фраза, выделенная руками через границу предложений) не предлагается:
 * разрез через неё уничтожил бы подсветку.
 */
export function cutGaps(text: string, lang: Lang = detectLang(text), phrases: Keyphrase[] = []): Gap[] {
  const parts = sentences(text, lang);
  const gaps: Gap[] = [];
  for (let i = 1; i < parts.length; i++) {
    const gap = { start: parts[i - 1]!.end, end: parts[i]!.start };
    if (!phrases.some((p) => p.start < gap.end && p.end > gap.start)) gaps.push(gap);
  }
  return gaps;
}

const reset = (b: Block): Block => ({
  ...b,
  userText: '',
  status: 'pending',
  hints: emptyHints(),
  typedChars: 0,
  pastedChars: 0,
  activeMs: 0,
});

/**
 * Режет блок в точке offset (начало правой части). Левая часть сохраняет id блока, правая получает новый.
 * Фразы целиком по одну сторону остаются со своей частью (правые сдвигаются). Фраза, которую режет точка,
 * удаляется: от неё осталась бы часть, не имеющая смысла.
 */
export function splitBlock(block: Block, offset: number, newId: () => string): [Block, Block] {
  const text = block.sourceText;
  const left = text.slice(0, offset).trimEnd();
  const tail = text.slice(offset);
  const rightStart = offset + (tail.length - tail.trimStart().length);
  const right = text.slice(rightStart);
  if (!left || !right) throw new Error('Разрез должен оставлять текст по обе стороны');

  return [
    reset({ ...block, sourceText: left, keyphrases: block.keyphrases.filter((p) => p.end <= left.length) }),
    reset({
      ...block,
      id: newId(),
      // Правая часть заголовка уже не заголовок.
      kind: block.kind === 'heading' ? 'text' : block.kind,
      sourceText: right,
      keyphrases: block.keyphrases
        .filter((p) => p.start >= rightStart)
        .map((p) => ({ start: p.start - rightStart, end: p.end - rightStart })),
    }),
  ];
}

/**
 * Склеивает блок со следующим, в том числе из другого абзаца (SPEC §6 п.8): paragraphIndex и id берутся
 * от первого блока, абзацы при экспорте сольются в один. Фразы обоих блоков сохраняются, фразы второго сдвигаются.
 * Вид блока сохраняется, если у блоков он одинаковый, иначе склейка считается обычным текстом.
 */
export function mergeBlocks(a: Block, b: Block): Block {
  const shift = a.sourceText.trimEnd().length + 1;
  return reset({
    ...a,
    kind: a.kind === b.kind ? a.kind : 'text',
    sourceText: `${a.sourceText.trimEnd()} ${b.sourceText.trimStart()}`,
    keyphrases: [...a.keyphrases, ...b.keyphrases.map((p) => ({ start: p.start + shift, end: p.end + shift }))],
  });
}

// --- операции над документом ----------------------------------------------------------------

/** До начала работы над текстом блоки можно править. Потом смена разбивки уничтожила бы написанное. */
export const hasProgress = (doc: Doc) => doc.blocks.some((b) => b.status !== 'pending');

const touch = (doc: Doc, blocks: Block[]): Doc => ({ ...doc, blocks, manualEdits: true });

/** Добирает фразы до минимума в блоках `indices`, остальное не трогает. */
function withTopUp(doc: Doc, blocks: Block[], indices: number[]): Block[] {
  const phrases = topUpKeyphrases(
    blocks.map((b) => ({ text: b.sourceText, kind: b.kind })),
    blocks.map((b) => b.keyphrases),
    indices,
    detectLang(doc.source),
  );
  return blocks.map((b, i) => (indices.includes(i) ? { ...b, keyphrases: phrases[i]! } : b));
}

export function setKeyphrases(doc: Doc, index: number, phrases: Keyphrase[]): Doc {
  return touch(doc, doc.blocks.map((b, i) => (i === index ? { ...b, keyphrases: phrases } : b)));
}

export function mergeDocBlocks(doc: Doc, index: number): Doc {
  const a = doc.blocks[index];
  const b = doc.blocks[index + 1];
  if (!a || !b) return doc;
  const blocks = [...doc.blocks.slice(0, index), mergeBlocks(a, b), ...doc.blocks.slice(index + 2)];
  return touch(doc, withTopUp(doc, blocks, [index]));
}

export function cutDocBlock(doc: Doc, index: number, offset: number, newId: () => string): Doc {
  const block = doc.blocks[index];
  if (!block) return doc;
  const [left, right] = splitBlock(block, offset, newId);
  const blocks = [...doc.blocks.slice(0, index), left, right, ...doc.blocks.slice(index + 1)];
  return touch(doc, withTopUp(doc, blocks, [index, index + 1]));
}

/** Пересчёт разбивки с нуля: все ручные правки теряются. */
export function resegmentDoc(doc: Doc, size: BlockSize, newId: () => string): Doc {
  return { ...doc, blockSize: size, manualEdits: false, blocks: buildBlocks(doc.source, size, newId), currentIndex: 0 };
}

// --- разметка текста для показа -------------------------------------------------------------

export type Segment =
  | { kind: 'text'; start: number; end: number }
  | { kind: 'phrase'; start: number; end: number; index: number }
  | { kind: 'gap'; start: number; end: number };

/** Режет текст блока на куски для показа: обычный текст, подсвеченные фразы и места разреза. */
export function buildSegments(text: string, phrases: Keyphrase[], gaps: Gap[]): Segment[] {
  const marks: Segment[] = [
    ...phrases.map((p, index) => ({ kind: 'phrase' as const, start: p.start, end: p.end, index })),
    ...gaps.map((g) => ({ kind: 'gap' as const, start: g.start, end: g.end })),
  ].sort((a, b) => a.start - b.start);

  const out: Segment[] = [];
  let pos = 0;
  for (const m of marks) {
    if (m.start < pos) continue; // пересечение: показывать нечего, лучше пропустить, чем сломать текст
    if (m.start > pos) out.push({ kind: 'text', start: pos, end: m.start });
    out.push(m);
    pos = m.end;
  }
  if (pos < text.length) out.push({ kind: 'text', start: pos, end: text.length });
  return out;
}
