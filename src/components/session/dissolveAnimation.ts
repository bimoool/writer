import { REDUCED_FADE_MS, WORD_MS, dissolveDelays } from '../../lib/dissolve';

export interface DissolveRun {
  /** Заканчивается, когда растворились все слова (или после finish). После cancel не вызывать. */
  finished: Promise<void>;
  /** Мгновенно довести до конца: например, когда приложение свернули посреди растворения. */
  finish: () => void;
  cancel: () => void;
}

const EASE = 'cubic-bezier(.4, 0, .2, 1)';

/**
 * Растворение блока (DESIGN §6.1) через Web Animations API: каждое слово `[data-w]` уходит в opacity 0,
 * blur 10px, на 14px вверх и увеличивается на 4%. Анимируются только opacity, transform и filter.
 * При reduced motion блок целиком гаснет за 220 мс.
 */
export function runDissolve(root: HTMLElement, reduced: boolean): DissolveRun {
  const words = [...root.querySelectorAll<HTMLElement>('[data-w]')];
  const animations: Animation[] = [];

  if (reduced || words.length === 0) {
    animations.push(root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: REDUCED_FADE_MS, easing: 'linear', fill: 'forwards' }));
  } else {
    const delays = dissolveDelays(words.length);
    words.forEach((el, i) => {
      el.style.willChange = 'transform, opacity, filter';
      animations.push(
        el.animate(
          [
            { opacity: 1, filter: 'blur(0px)', transform: 'translateY(0) scale(1)' },
            { opacity: 0, filter: 'blur(10px)', transform: 'translateY(-14px) scale(1.04)' },
          ],
          { duration: WORD_MS, delay: delays[i], easing: EASE, fill: 'both' },
        ),
      );
    });
  }

  const clear = () => words.forEach((w) => (w.style.willChange = ''));
  const finished = Promise.all(animations.map((a) => a.finished.catch(() => undefined))).then(clear);
  return {
    finished,
    finish: () => animations.forEach((a) => a.finish()),
    cancel: () => {
      animations.forEach((a) => a.cancel());
      clear();
    },
  };
}
