/**
 * Подсчёт набранных и вставленных символов по событиям input (SPEC §8).
 *
 * Считаем по inputType, а не по длине значения, и так, чтобы телефон не давал двойного счёта:
 * экранная клавиатура и IME обновляют слово целиком на каждое нажатие (insertCompositionText с
 * data = всё слово до сих пор), поэтому для композиции считаем только прирост длины.
 */

export interface CounterState {
  /** Сколько символов текущей композиции уже учтено. */
  composed: number;
}

export interface InputInfo {
  inputType: string;
  data: string | null;
  /** Сколько символов добавилось в поле (по длине значения до и после, с учётом заменённого выделения). */
  inserted: number;
}

export interface InputCount {
  typed: number;
  pasted: number;
  state: CounterState;
}

export const initialCounter = (): CounterState => ({ composed: 0 });

/** compositionstart и compositionend: следующая композиция считается с нуля. */
export const resetComposition = (): CounterState => ({ composed: 0 });

export const PASTE_TYPES: ReadonlySet<string> = new Set(['insertFromPaste', 'insertFromPasteAsQuotation', 'insertFromDrop', 'insertFromYank']);

export const isPasteInput = (inputType: string) => PASTE_TYPES.has(inputType);

const length = (s: string) => Array.from(s).length;

export function countInput(state: CounterState, info: InputInfo): InputCount {
  const none = { typed: 0, pasted: 0, state };
  switch (info.inputType) {
    case 'insertText':
      // data есть почти всегда; без него полагаемся на длину вставки.
      return { ...none, typed: info.data !== null ? length(info.data) : Math.max(0, info.inserted) };

    case 'insertCompositionText': {
      const now = length(info.data ?? '');
      return { typed: Math.max(0, now - state.composed), pasted: 0, state: { composed: now } };
    }

    // Итог композиции (Safari) и автозамена целого слова уже учтены или не добавляют набранного.
    case 'insertFromComposition':
    case 'insertReplacementText':
      return none;

    // Перевод строки набирается пользователем, хотя в SPEC про него ничего нет.
    case 'insertLineBreak':
    case 'insertParagraph':
      return { ...none, typed: 1 };

    default:
      return isPasteInput(info.inputType) ? { ...none, pasted: Math.max(0, info.inserted) } : none;
  }
}
