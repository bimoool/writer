import { countWords, detectLang, segmenter, tokenize, type Lang } from './tokens';
import type { BlockKind, BlockSize } from './types';

/** Разбивка текста на блоки (SPEC §6). */

export const BLOCK_LIMITS: Record<BlockSize, number> = { short: 25, medium: 45, long: 70 };
export const SOFT_MIN_WORDS = 8;
const TAIL_GLUE_FACTOR = 1.3;
const SHORT_HEADING_WORDS = 8;

export interface Paragraph {
  kind: BlockKind;
  text: string;
  /** Сколько строк исходника склеено в абзац. Нужно для правила «короткая строка = заголовок». */
  lines: number;
}

export interface Segment {
  paragraphIndex: number;
  kind: BlockKind;
  text: string;
}

const HEADING_RE = /^\s*#+\s*/;
const LIST_RE = /^\s*(?:[-*•]|\d+[.)])\s+/;
const TERMINAL_RE = /[.!?…:;,][\s"»”’')\]]*$/u;

/** Шаг 1: нормализация, абзацы, заголовки, пункты списка, правило 7. */
export function splitParagraphs(input: string, lang: Lang = detectLang(input)): Paragraph[] {
  const out: Paragraph[] = [];
  let cur: { kind: BlockKind; lines: string[] } | null = null;

  const flush = () => {
    if (!cur) return;
    const text = cur.lines.join(' ').replace(/[ \t]+/g, ' ').trim();
    if (text) {
      let kind = cur.kind;
      if (
        kind === 'text' &&
        cur.lines.length === 1 &&
        !TERMINAL_RE.test(text) &&
        countWords(text, lang) > 0 &&
        countWords(text, lang) <= SHORT_HEADING_WORDS
      ) {
        kind = 'heading';
      }
      out.push({ kind, text, lines: cur.lines.length });
    }
    cur = null;
  };

  for (const line of input.replace(/\r\n?/g, '\n').split('\n')) {
    if (!line.trim()) {
      flush();
    } else if (HEADING_RE.test(line)) {
      flush();
      cur = { kind: 'heading', lines: [line.replace(HEADING_RE, '')] };
      flush();
    } else if (LIST_RE.test(line)) {
      flush();
      cur = { kind: 'list-item', lines: [line.replace(LIST_RE, '')] };
    } else {
      // Строка без отступа после пункта списка начинает новый абзац, с отступом продолжает пункт.
      if (cur?.kind === 'list-item' && !/^\s/.test(line)) flush();
      cur ??= { kind: 'text', lines: [] };
      cur.lines.push(line.trim());
    }
  }
  flush();
  return out;
}

interface Range {
  start: number;
  end: number;
}

const ABBREVIATIONS = ['т.е.', 'т.д.', 'т.п.', 'г.', 'гг.', 'см.', 'др.', 'ок.', 'dr.', 'e.g.', 'i.e.', 'etc.'];

function endsWithAbbreviation(s: string): boolean {
  const t = s.trimEnd().toLowerCase();
  return ABBREVIATIONS.some((a) => t.endsWith(a) && !/\p{L}/u.test(t.charAt(t.length - a.length - 1)));
}

const trimRange = (text: string, r: Range): Range => {
  let { start, end } = r;
  while (start < end && /\s/.test(text[start]!)) start++;
  while (end > start && /\s/.test(text[end - 1]!)) end--;
  return { start, end };
};

const wordsIn = (text: string, r: Range, lang: Lang) => countWords(text.slice(r.start, r.end), lang);

/** Предложения абзаца с учётом сокращений (правило 6). */
export function sentences(text: string, lang: Lang): Range[] {
  const raw: Range[] = [];
  for (const s of segmenter(lang, 'sentence').segment(text)) {
    const r = trimRange(text, { start: s.index, end: s.index + s.segment.length });
    if (r.end > r.start) raw.push(r);
  }
  const out: Range[] = [];
  for (let i = 0; i < raw.length; i++) {
    let r = raw[i]!;
    while (
      i + 1 < raw.length &&
      wordsIn(text, r, lang) < 3 &&
      endsWithAbbreviation(text.slice(r.start, r.end))
    ) {
      r = { start: r.start, end: raw[++i]!.end };
    }
    out.push(r);
  }
  return out;
}

const CONJ = 'потому что|и|а|но|который|которая|которые|что|где|когда|and|but|which|because|while';
const SPLIT_PATTERNS: RegExp[] = [
  /[;:](?=\s)/gu,
  /\s[—–-](?=\s)/gu,
  new RegExp(`,(?=\\s+(?:${CONJ})(?!\\p{L}))`, 'giu'),
];

/** Правило 4: длинное предложение режем по ; : — или запятой перед союзом, ближе к середине. */
export function splitLongSentence(text: string, r: Range, limit: number, lang: Lang): Range[] {
  const slice = text.slice(r.start, r.end);
  const tokens = tokenize(slice, lang);
  if (tokens.length <= limit) return [r];

  const total = tokens.length;
  const wordsBefore = (pos: number) => tokens.filter((t) => t.end <= pos).length;
  const best = (positions: number[]): number | null => {
    let pick: number | null = null;
    let dist = Infinity;
    for (const pos of positions) {
      const before = wordsBefore(pos);
      if (before < 1 || before > total - 1) continue;
      const d = Math.abs(before - total / 2);
      if (d < dist) {
        dist = d;
        pick = pos;
      }
    }
    return pick;
  };

  const candidates: number[] = [];
  for (const re of SPLIT_PATTERNS) {
    for (const m of slice.matchAll(re)) candidates.push(m.index + m[0].length);
  }
  let cut = best(candidates);
  // Запасные варианты, если в предложении нет нужных знаков: любая запятая, затем граница слов.
  if (cut === null) cut = best([...slice.matchAll(/,(?=\s)/g)].map((m) => m.index + 1));
  if (cut === null) cut = tokens[Math.floor(total / 2)]!.start;

  const left = trimRange(text, { start: r.start, end: r.start + cut });
  const right = trimRange(text, { start: r.start + cut, end: r.end });
  return [...splitLongSentence(text, left, limit, lang), ...splitLongSentence(text, right, limit, lang)];
}

/**
 * Правило 3: делим единицы (предложения) на минимально возможное число блоков не длиннее лимита,
 * а среди таких разбиений выбираем самое ровное (минимум суммы квадратов отклонений от слов / n).
 */
function partition(words: number[], limit: number): number[][] {
  const m = words.length;
  const total = words.reduce((a, b) => a + b, 0);

  const minChunks = new Array<number>(m + 1).fill(Infinity);
  minChunks[0] = 0;
  for (let j = 1; j <= m; j++) {
    let sum = 0;
    for (let i = j - 1; i >= 0; i--) {
      sum += words[i]!;
      if (sum > limit && i < j - 1) break;
      minChunks[j] = Math.min(minChunks[j]!, minChunks[i]! + 1);
    }
  }
  const target = total / minChunks[m]!;

  const chunks = new Array<number>(m + 1).fill(Infinity);
  const dev = new Array<number>(m + 1).fill(Infinity);
  const from = new Array<number>(m + 1).fill(0);
  chunks[0] = 0;
  dev[0] = 0;
  for (let j = 1; j <= m; j++) {
    let sum = 0;
    for (let i = j - 1; i >= 0; i--) {
      sum += words[i]!;
      if (sum > limit && i < j - 1) break;
      const c = chunks[i]! + 1;
      const d = dev[i]! + (sum - target) ** 2;
      if (c < chunks[j]! || (c === chunks[j]! && d < dev[j]!)) {
        chunks[j] = c;
        dev[j] = d;
        from[j] = i;
      }
    }
  }

  const out: number[][] = [];
  for (let j = m; j > 0; j = from[j]!) {
    const group: number[] = [];
    for (let k = from[j]!; k < j; k++) group.push(k);
    out.unshift(group);
  }
  return out;
}

function chunkParagraph(p: Paragraph, limit: number, lang: Lang): string[] {
  if (countWords(p.text, lang) <= limit) return [p.text];

  const units = sentences(p.text, lang).flatMap((r) => splitLongSentence(p.text, r, limit, lang));
  const words = units.map((u) => wordsIn(p.text, u, lang));
  const groups = partition(words, limit);

  // Правило 5: блок короче минимума (хвост, но и начало, и середина) приклеиваем к соседу, если вместе не больше
  // лимит × 1.3. Предпочитаем предыдущего, а из двух подходящих соседей берём того, с кем получается короче блок.
  const size = (g: number[]) => g.reduce((a, i) => a + words[i]!, 0);
  const max = limit * TAIL_GLUE_FACTOR;
  for (;;) {
    let merged = false;
    for (let k = 0; k < groups.length && groups.length > 1; k++) {
      const own = size(groups[k]!);
      if (own >= SOFT_MIN_WORDS) continue;
      const prev = k > 0 ? size(groups[k - 1]!) + own : Infinity;
      const next = k < groups.length - 1 ? size(groups[k + 1]!) + own : Infinity;
      const pick = prev <= max && (prev <= next || next > max) ? k - 1 : next <= max ? k : -1;
      if (pick < 0) continue;
      groups.splice(pick, 2, [...groups[pick]!, ...groups[pick + 1]!]);
      merged = true;
      break;
    }
    if (!merged) break;
  }

  return groups.map((g) => p.text.slice(units[g[0]!]!.start, units[g[g.length - 1]!]!.end).trim());
}

export function segment(input: string, size: BlockSize = 'medium', lang: Lang = detectLang(input)): Segment[] {
  const limit = BLOCK_LIMITS[size];
  return splitParagraphs(input, lang).flatMap((p, paragraphIndex) =>
    chunkParagraph(p, limit, lang).map((text) => ({ paragraphIndex, kind: p.kind, text })),
  );
}
