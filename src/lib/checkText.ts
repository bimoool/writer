import { sentences } from './segment';
import { detectLang } from './tokens';
import type { BlockKind } from './types';

/**
 * Текст пользователя для проверки (SPEC §15). Собирается из блоков так же, как экспорт: блоки одного абзаца через пробел,
 * абзацы через пустую строку. Каждый кусок помнит, откуда он взят, чтобы найденное место можно было показать в блоке
 * и исправить в нём.
 */

export interface Range {
  start: number;
  end: number;
}

export interface CheckPart extends Range {
  blockId: string;
  /** Смещение начала куска в block.userText (текст блока обрезается по краям). */
  lead: number;
}

export interface CheckParagraph extends Range {
  kind: BlockKind;
  sentences: Range[];
}

export interface CheckText {
  text: string;
  parts: CheckPart[];
  paragraphs: CheckParagraph[];
}

interface CheckBlock {
  id: string;
  paragraphIndex: number;
  kind: BlockKind;
  userText: string;
}

export function buildCheckText(blocks: CheckBlock[]): CheckText {
  let text = '';
  const parts: CheckPart[] = [];
  const paragraphs: Array<Range & { kind: BlockKind }> = [];
  let lastIndex: number | null = null;
  for (const b of blocks) {
    const trimmed = b.userText.trim();
    if (!trimmed) continue;
    const lead = b.userText.length - b.userText.trimStart().length;
    const last = paragraphs[paragraphs.length - 1];
    if (last && lastIndex === b.paragraphIndex) text += ' ';
    else {
      if (text) text += '\n\n';
      paragraphs.push({ start: text.length, end: text.length, kind: b.kind });
    }
    const start = text.length;
    text += trimmed;
    parts.push({ blockId: b.id, start, end: text.length, lead });
    paragraphs[paragraphs.length - 1]!.end = text.length;
    lastIndex = b.paragraphIndex;
  }
  const lang = detectLang(text);
  return {
    text,
    parts,
    paragraphs: paragraphs.map((p) => ({
      ...p,
      sentences: sentences(text.slice(p.start, p.end), lang).map((s) => ({ start: s.start + p.start, end: s.end + p.start })),
    })),
  };
}

/** Часть, в которую попадает позиция (конец куска не включается). */
export const partAt = (parts: CheckPart[], pos: number): CheckPart | undefined => parts.find((p) => pos >= p.start && pos < p.end);

/** Заменяет диапазон текста в userText блока. Диапазон должен лежать внутри одного куска. */
export function replaceInBlock(userText: string, part: CheckPart, range: Range, replacement: string): string {
  const from = part.lead + range.start - part.start;
  const to = part.lead + range.end - part.start;
  return userText.slice(0, from) + replacement + userText.slice(to);
}

/** Документ с исправленным текстом одного блока. Остальные поля блока (метрики набора, подсказки) не трогаются. */
export function replaceInDoc<D extends { blocks: Array<{ id: string; userText: string }> }>(
  doc: D,
  part: CheckPart,
  range: Range,
  replacement: string,
): D {
  return {
    ...doc,
    blocks: doc.blocks.map((b) => (b.id === part.blockId ? { ...b, userText: replaceInBlock(b.userText, part, range, replacement) } : b)),
  };
}
