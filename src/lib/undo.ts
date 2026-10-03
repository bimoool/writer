import type { Block, BlockSize, Doc } from './types';

/**
 * Отмена правок разбивки на экране Split (склейка, разрез, фразы, смена размера).
 * Стек живёт только в памяти экрана и сбрасывается при выходе. Блоки неизменяемы, поэтому снимок хранит
 * ссылки, а не копии. Править разбивку можно только пока работа над текстом не начата, так что
 * восстановление не может затереть написанное пользователем.
 */

export interface Snapshot {
  blocks: Block[];
  blockSize: BlockSize;
  manualEdits: boolean;
  currentIndex: number;
}

export const MAX_UNDO = 50;

export const snapshotOf = (doc: Doc): Snapshot => ({
  blocks: doc.blocks,
  blockSize: doc.blockSize,
  manualEdits: doc.manualEdits,
  currentIndex: doc.currentIndex,
});

/** Правка что-то изменила: блоки или размер. */
export const changed = (before: Doc, after: Doc) => before.blocks !== after.blocks || before.blockSize !== after.blockSize;

export const pushUndo = (stack: readonly Snapshot[], snap: Snapshot): Snapshot[] => [...stack, snap].slice(-MAX_UNDO);

export const restoreSnapshot = (doc: Doc, snap: Snapshot): Doc => ({ ...doc, ...snap });
