import { describe, expect, it } from 'vitest';
import { countInput, initialCounter, isPasteInput, resetComposition, type InputInfo } from './typing';

/** Прогоняет последовательность событий input через счётчик, как это делает поле письма. */
function run(events: Array<InputInfo | 'compositionend' | 'compositionstart'>) {
  let state = initialCounter();
  let typed = 0;
  let pasted = 0;
  for (const e of events) {
    if (e === 'compositionend' || e === 'compositionstart') {
      state = resetComposition();
      continue;
    }
    const r = countInput(state, e);
    typed += r.typed;
    pasted += r.pasted;
    state = r.state;
  }
  return { typed, pasted };
}

const text = (data: string): InputInfo => ({ inputType: 'insertText', data, inserted: data.length });
const comp = (data: string): InputInfo => ({ inputType: 'insertCompositionText', data, inserted: 1 });

describe('обычный набор', () => {
  it('каждый символ insertText считается один раз', () => {
    expect(run([...'привет'].map(text))).toEqual({ typed: 6, pasted: 0 });
  });

  it('длинная вставка текста через insertText (автодополнение целого слова) считается набранной по длине data', () => {
    expect(run([text('привет ')])).toEqual({ typed: 7, pasted: 0 });
  });

  it('эмодзи считается одним символом', () => {
    expect(run([text('😀')]).typed).toBe(1);
  });

  it('без data берём длину вставки', () => {
    expect(run([{ inputType: 'insertText', data: null, inserted: 3 }]).typed).toBe(3);
    expect(run([{ inputType: 'insertText', data: null, inserted: -2 }]).typed).toBe(0);
  });

  it('перевод строки считается набранным, удаление и откат нет', () => {
    expect(run([{ inputType: 'insertLineBreak', data: null, inserted: 1 }, { inputType: 'insertParagraph', data: null, inserted: 1 }]).typed).toBe(2);
    for (const inputType of ['deleteContentBackward', 'deleteWordBackward', 'historyUndo', 'historyRedo', 'formatBold']) {
      expect(run([{ inputType, data: null, inserted: 0 }])).toEqual({ typed: 0, pasted: 0 });
    }
  });
});

describe('экранная клавиатура и IME: композиция не считается дважды', () => {
  it('слово «привет», набранное композицией: 6, а не 1+2+3+4+5+6 = 21', () => {
    const steps = ['п', 'пр', 'при', 'прив', 'приве', 'привет'].map(comp);
    expect(run(['compositionstart', ...steps, 'compositionend']).typed).toBe(6);
  });

  it('несколько слов подряд, каждое своей композицией', () => {
    const word = (w: string) => ['compositionstart' as const, ...Array.from({ length: [...w].length }, (_, i) => comp([...w].slice(0, i + 1).join(''))), 'compositionend' as const];
    expect(run([...word('привет'), text(' '), ...word('мир')]).typed).toBe(6 + 1 + 3);
  });

  it('удаление внутри композиции не уменьшает счёт, повторный набор считается', () => {
    // «при» (3), стёрли до «пр», снова «при»: 3 + 0 + 1
    expect(run([comp('при'), comp('пр'), comp('при')]).typed).toBe(4);
  });

  it('автозамена внутри композиции той же длины ничего не добавляет', () => {
    expect(run([comp('првиет'), comp('привет')]).typed).toBe(6);
  });

  it('конвертация IME (かんじ → 漢字 → 感じ) считает набранные три символа один раз', () => {
    expect(run(['compositionstart', comp('か'), comp('かん'), comp('かんじ'), comp('漢字'), comp('感じ'), 'compositionend']).typed).toBe(3);
  });

  it('Safari: итог композиции insertFromComposition не прибавляет второй раз', () => {
    const final: InputInfo = { inputType: 'insertFromComposition', data: 'привет', inserted: 6 };
    expect(run(['compositionstart', ...['п', 'пр', 'при', 'прив', 'приве', 'привет'].map(comp), 'compositionend', final]).typed).toBe(6);
  });

  it('автозамена целого слова insertReplacementText набранного не добавляет', () => {
    expect(run([text('п'), text('р'), { inputType: 'insertReplacementText', data: 'привет', inserted: 6 }]).typed).toBe(2);
  });

  it('композиция без data ничего не ломает', () => {
    expect(run([{ inputType: 'insertCompositionText', data: null, inserted: 1 }]).typed).toBe(0);
  });
});

describe('вставка', () => {
  it('вставка, перенос мышью и yank идут в pastedChars, не в typedChars', () => {
    for (const inputType of ['insertFromPaste', 'insertFromPasteAsQuotation', 'insertFromDrop', 'insertFromYank']) {
      expect(isPasteInput(inputType)).toBe(true);
      expect(run([{ inputType, data: null, inserted: 120 }])).toEqual({ typed: 0, pasted: 120 });
    }
  });

  it('набор и вставка вместе дают долю набранного', () => {
    const r = run([...[...'привет'].map(text), { inputType: 'insertFromPaste', data: null, inserted: 18 }]);
    expect(r).toEqual({ typed: 6, pasted: 18 });
    expect(r.typed / (r.typed + r.pasted)).toBeCloseTo(0.25, 6);
  });

  it('insertText и композиция вставкой не считаются', () => {
    expect(isPasteInput('insertText')).toBe(false);
    expect(isPasteInput('insertCompositionText')).toBe(false);
  });
});
