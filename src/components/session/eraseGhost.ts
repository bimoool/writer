import { WORD_FADE_MS, type WordRange } from '../../lib/pressure';
import { copyTextLayout } from './caret';

const EASE = 'cubic-bezier(.4,0,.2,1)';

export interface EraseGhost {
  remove(): void;
}

/**
 * Растворение стираемого слова (DESIGN §6.5 и §6.1). Часть текста textarea анимировать нельзя, поэтому поверх поля
 * кладётся его точная копия (та же раскладка и шрифт), где последнее слово растворяется за 300 мс, а текст самого
 * поля на это время становится прозрачным. Каретка поля остаётся видна (у неё свой цвет), копия касаний не ловит.
 * Плашек цвета фона нет, так что виньетка под полем не перекрывается. Если слово переносится на две строки,
 * возвращаем null, и слово удаляется без анимации.
 */
export function showEraseGhost(ta: HTMLTextAreaElement, range: WordRange): EraseGhost | null {
  const host = ta.parentElement;
  if (!host || ta.offsetParent !== host) return null;

  const copy = document.createElement('div');
  copy.setAttribute('aria-hidden', 'true');
  copy.dataset.erasing = '';
  copyTextLayout(getComputedStyle(ta), copy);
  Object.assign(copy.style, {
    position: 'absolute',
    left: `${ta.offsetLeft}px`,
    top: `${ta.offsetTop}px`,
    height: `${ta.offsetHeight}px`,
    margin: '0',
    borderStyle: 'solid',
    borderColor: 'transparent',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    color: 'var(--text)',
    pointerEvents: 'none',
  });
  const word = document.createElement('span');
  word.textContent = ta.value.slice(range.chunkStart, range.chunkEnd);
  Object.assign(word.style, { display: 'inline-block', willChange: 'transform, opacity, filter' });
  copy.append(ta.value.slice(0, range.chunkStart), word, ta.value.slice(range.chunkEnd));
  host.append(copy);

  if (word.getClientRects().length !== 1) {
    copy.remove();
    return null;
  }
  ta.dataset.erasingWord = '';
  word.animate(
    [
      { opacity: 1, filter: 'blur(0px)', transform: 'translateY(0) scale(1)' },
      { opacity: 0, filter: 'blur(10px)', transform: 'translateY(-14px) scale(1.04)' },
    ],
    { duration: WORD_FADE_MS, easing: EASE, fill: 'forwards' },
  );
  return {
    remove() {
      copy.remove();
      delete ta.dataset.erasingWord;
    },
  };
}
