/**
 * Общий режим разреза на Split (SPEC §3.2): один на весь экран, включается и выключается пользователем и остаётся
 * включённым после каждого разреза. Здесь только состояние; сам разрез делает `cutDocBlock`, UI остаётся тонким.
 */

export const CUT_NOTICE_MS = 3000;
export const CUT_FLASH_MS = 800;

export interface CutModeState {
  on: boolean;
  /** Одноразовое пояснение показывается в подсказке, пока режим включён (первое включение на устройстве). */
  intro: boolean;
  /** Блок, чья правая часть только что появилась: коротко подсвечивается. */
  flashId: string | null;
  /** Сколько блоков стало после последнего разреза: сообщение рядом с заголовком. */
  notice: number | null;
}

export type CutModeAction =
  | { type: 'enable'; firstTime: boolean }
  | { type: 'exit' }
  | { type: 'cut'; rightId: string; total: number }
  | { type: 'undo' }
  | { type: 'clearFlash' }
  | { type: 'clearNotice' };

export const initialCutMode: CutModeState = { on: false, intro: false, flashId: null, notice: null };

export function cutModeReducer(state: CutModeState, action: CutModeAction): CutModeState {
  switch (action.type) {
    case 'enable':
      return { ...state, on: true, intro: action.firstTime };
    case 'exit':
      // Сообщение и подсветка о прошлом разрезе гаснут сами по таймеру, режим их не трогает.
      return { ...state, on: false, intro: false };
    case 'cut':
      // Режим остаётся таким, какой был: разрез мышью без режима его не включает, разрез в режиме не выключает.
      return { ...state, flashId: action.rightId, notice: action.total };
    case 'undo':
      // Отмена откатывает и разрез: сообщение о нём и подсветка уже не про текущее состояние. Режим остаётся.
      return { ...state, flashId: null, notice: null };
    case 'clearFlash':
      return state.flashId === null ? state : { ...state, flashId: null };
    case 'clearNotice':
      return state.notice === null ? state : { ...state, notice: null };
  }
}
