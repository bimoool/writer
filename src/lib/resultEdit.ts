import { patchBlock, canFinish } from './session';
import type { Doc } from './types';

/**
 * Правка текста на экране Result (SPEC §15.5). Правило подсчёта то же, что в Session (SPEC §8): набранное и вставленное
 * копятся в typedChars и pastedChars, текст блока пишется в userText. Давления и подсчёта времени здесь нет.
 */

export interface EditCounts {
  typed: number;
  pasted: number;
}

/**
 * Новое значение поля блока. Пустое (из одних пробелов) значение в документ не пишется: пустой блок сохранить нельзя,
 * его прежний текст остаётся в документе, пока пользователь не напишет хоть слово.
 */
export function applyEdit(doc: Doc, blockId: string, value: string, counts: EditCounts): Doc {
  const index = doc.blocks.findIndex((b) => b.id === blockId);
  if (index < 0 || !canFinish(value)) return doc;
  return patchBlock(doc, index, (b) => ({
    userText: value,
    typedChars: b.typedChars + counts.typed,
    pastedChars: b.pastedChars + counts.pasted,
  }));
}

/** Выход из поля: пустой блок возвращается к тексту, с которым поле открыли. */
export function leaveEdit(doc: Doc, blockId: string, draft: string, startText: string): { doc: Doc; restored: boolean } {
  if (canFinish(draft)) return { doc, restored: false };
  const index = doc.blocks.findIndex((b) => b.id === blockId);
  if (index < 0) return { doc, restored: false };
  return { doc: patchBlock(doc, index, () => ({ userText: startText })), restored: true };
}
