import { countWords } from './tokens';
import type { Block, Doc } from './types';

/**
 * Состояния блока в сессии (SPEC §3.3). В хранилище только `pending | writing | done`, а `reading` и `dissolving`
 * существуют лишь в интерфейсе:
 * - pending: блок ещё не показывали, после перезагрузки откроется в reading;
 * - writing: ставится в момент «Запомнил», ещё до растворения, поэтому закрытие вкладки посреди растворения
 *   возвращает пользователя сразу в writing;
 * - done: блок завершён, правка через «Назад к предыдущему блоку» открывает его сразу в writing.
 */
export type Phase = 'reading' | 'dissolving' | 'writing';

export const initialPhase = (block: Block): Phase => (block.status === 'pending' ? 'reading' : 'writing');

/** Первый блок, который ещё не завершён. Если завершены все, равен числу блоков. */
export function frontierIndex(doc: Doc): number {
  const i = doc.blocks.findIndex((b) => b.status !== 'done');
  return i < 0 ? doc.blocks.length : i;
}

/** Пустой блок завершить нельзя (SPEC §3.3). */
export const canFinish = (text: string) => countWords(text) > 0;

export function patchBlock(doc: Doc, index: number, patch: (block: Block) => Partial<Block>): Doc {
  const block = doc.blocks[index];
  if (!block) return doc;
  const blocks = doc.blocks.slice();
  blocks[index] = { ...block, ...patch(block) };
  return { ...doc, blocks };
}

/** «Запомнил»: блок переходит в writing до начала анимации. Завершённый блок не откатывается. */
export const startWriting = (doc: Doc, index: number): Doc =>
  patchBlock(doc, index, (b) => (b.status === 'pending' ? { status: 'writing' } : {}));

/** «Готово»: блок завершён, currentIndex указывает на первый незавершённый, а после последнего блока ставится finishedAt. */
export function completeBlock(doc: Doc, index: number, now: number): Doc {
  const next = patchBlock(doc, index, () => ({ status: 'done' }));
  const front = frontierIndex(next);
  const finished = front >= next.blocks.length;
  return {
    ...next,
    currentIndex: Math.min(front, Math.max(0, next.blocks.length - 1)),
    ...(finished && next.finishedAt === undefined ? { finishedAt: now } : {}),
  };
}
