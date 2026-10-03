import { useEffect, useRef, type RefObject } from 'react';
import {
  WORD_FADE_MS,
  createPressure,
  cutWord,
  erasableWordRange,
  reducePressure,
  shiftAfterCut,
  steppedVignette,
  tick,
  type ActivityKind,
  type CompositionRange,
  type PauseReason,
  type PressureEvent,
  type WordRange,
} from '../../lib/pressure';
import type { Lang } from '../../lib/tokens';
import type { PressureMode } from '../../lib/types';
import { showEraseGhost, type EraseGhost } from './eraseGhost';

const TICK_MS = 100;
const now = () => Date.now();

/** Виньетка пишется прямо в style: она меняется 10 раз в секунду, перерисовывать ради неё экран незачем. */
function setVignette(el: HTMLElement, v: number) {
  const value = String(Math.round(v * 1000) / 1000);
  if (el.style.opacity !== value) el.style.opacity = value;
  el.dataset.level = value;
}

/**
 * Вырезает слово из поля. Без композиции каретка встаёт в конец; с композицией остаётся в слове,
 * которое пишется, со сдвигом на длину вырезанного. Возвращает новый текст.
 */
function cutFromField(ta: HTMLTextAreaElement, range: WordRange, composing: boolean): string {
  const { selectionStart, selectionEnd } = ta;
  const next = cutWord(ta.value, range);
  ta.value = next;
  if (composing) ta.setSelectionRange(shiftAfterCut(selectionStart, range), shiftAfterCut(selectionEnd, range));
  else ta.setSelectionRange(next.length, next.length);
  return next;
}

/**
 * Где в поле идёт композиция. Обычно каретка стоит в конце слова в композиции, и текст перед ней совпадает
 * с data из compositionupdate. Если не совпал (IME не прислал data), берём пустой диапазон у каретки:
 * erasableWordRange всё равно защищает весь фрагмент между пробелами, в котором стоит каретка.
 */
function compositionRange(ta: HTMLTextAreaElement, data: string): CompositionRange {
  const end = ta.selectionEnd;
  const start = end - data.length;
  if (data && start >= 0 && ta.value.slice(start, end) === data) return { start, end };
  return { start: end, end };
}

interface Options {
  /** Уже с учётом правки done-блока (effectiveMode): там всегда off. */
  mode: PressureMode;
  delaySec: number;
  /** Блок в состоянии writing. В reading и dissolving давления нет. */
  active: boolean;
  /** Причины паузы, которые знает экран. Скрытую вкладку хук отслеживает сам. */
  paused: Record<'hint' | 'peek' | 'modal', boolean>;
  field: RefObject<HTMLTextAreaElement>;
  vignette: RefObject<HTMLDivElement>;
  lang: Lang;
  reduced: boolean;
  /** Слово стёрто: новый текст текущего блока. Только текст, счётчики набранного не трогаются. */
  onErase: (text: string) => void;
}

/**
 * Давление (SPEC §7) в сессии. Автомат из lib/pressure живёт в ref: тикает раз в 100 мс и пишет виньетку
 * прямо в style.opacity, без перерисовки React. Стирает только текст поля текущего блока и только когда
 * текст не менялся с начала растворения слова; правка done-блока сюда приходит с mode = off.
 */
export function usePressure(opts: Options) {
  const { mode, delaySec, active, paused, field, vignette, reduced } = opts;
  const state = useRef(createPressure(mode, delaySec));
  const live = useRef(opts);
  /** Текст в композиции IME (data последнего compositionupdate) или null, если композиции нет. */
  const composing = useRef<string | null>(null);
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; ghost: EraseGhost | null } | null>(null);

  useEffect(() => {
    live.current = opts;
  });

  const dispatch = (e: PressureEvent) => {
    state.current = reducePressure(state.current, e);
  };

  const show = (v: number) => {
    if (vignette.current) setVignette(vignette.current, v);
  };

  /** Слово растворяется, но пользователь успел что-то сделать: слово остаётся на месте. */
  const cancelPending = () => {
    const p = pending.current;
    if (!p) return;
    clearTimeout(p.timer);
    p.ghost?.remove();
    pending.current = null;
  };

  const apply = (text: string, range: WordRange, inComposition: boolean) => {
    const ta = field.current;
    // Текст поменялся: стирать уже нельзя, это другие слова. Любое событие композиции и так отменяет стирание.
    if (!ta || ta.value !== text) return;
    // Текст меняется прямо в том же поле, без пересоздания и без blur: фокус остаётся, клавиатура не закрывается.
    // Именно через сеттер value, а не setRangeText: React следит за значением через этот сеттер, и иначе,
    // если пользователь допечатает ровно стёртое, React счёл бы ввод «без изменений» и потерял его.
    live.current.onErase(cutFromField(ta, range, inComposition));
  };

  const erase = () => {
    const ta = field.current;
    if (!ta) return;
    dispatch({ type: 'deleted' });
    const text = ta.value;
    const data = composing.current;
    // Слово в композиции не дописано и не стирается: уходит последнее законченное слово перед ним.
    const range = erasableWordRange(text, data === null ? null : compositionRange(ta, data), live.current.lang);
    // Слов нет (или есть только слово в композиции): стирать нечего, виньетка остаётся на максимуме.
    if (!range) return;
    const inComposition = data !== null;
    if (live.current.reduced) {
      apply(text, range, inComposition);
      return;
    }
    const ghost = showEraseGhost(ta, range);
    const timer = setTimeout(() => {
      pending.current = null;
      apply(text, range, inComposition);
      ghost?.remove();
    }, WORD_FADE_MS);
    pending.current = { timer, ghost };
  };

  const activity = (kind: ActivityKind) => {
    dispatch({ type: 'activity', kind, now: now() });
    cancelPending();
    show(0);
  };

  const setPause = (reason: PauseReason, on: boolean) => {
    dispatch({ type: on ? 'pause' : 'resume', reason, now: now() });
    if (on) {
      cancelPending();
      show(0);
    }
  };

  /**
   * Состояние композиции из поля: текст в ней или null, когда она закончилась (или ушли из поля).
   * Паузы нет: сами события композиции приходят в activity и сбрасывают бездействие (SPEC §7).
   */
  const composition = (data: string | null) => {
    composing.current = data;
  };

  // Смена режима или задержки в настройках посреди блока.
  useEffect(() => {
    dispatch({ type: 'configure', mode, delaySec, now: now() });
  }, [mode, delaySec]);

  useEffect(() => setPause('hint', paused.hint), [paused.hint]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setPause('peek', paused.peek), [paused.peek]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setPause('modal', paused.modal), [paused.modal]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onVisibility = () => setPause('hidden', document.visibilityState === 'hidden');
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
    // setPause читает только refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!active || mode === 'off') {
      composing.current = null;
      cancelPending();
      show(0);
      return;
    }
    const step = () => {
      const r = tick(state.current, now());
      show(reduced ? steppedVignette(r.vignette) : r.vignette);
      if (r.deleteWord && !pending.current) erase();
    };
    const id = setInterval(step, TICK_MS);
    return () => clearInterval(id);
    // erase, show и cancelPending читают только refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, mode, reduced]);

  useEffect(() => cancelPending, []);

  return { activity, composition };
}
