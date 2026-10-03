import { useEffect, useRef, type RefObject } from 'react';
import {
  WORD_FADE_MS,
  createPressure,
  lastWordRange,
  reducePressure,
  steppedVignette,
  tick,
  type ActivityKind,
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

/** Новый текст поля и каретка в конце. Возвращает этот текст. */
function replaceText(ta: HTMLTextAreaElement, next: string): string {
  ta.value = next;
  ta.setSelectionRange(next.length, next.length);
  return next;
}

interface Options {
  /** Уже с учётом правки done-блока (effectiveMode): там всегда off. */
  mode: PressureMode;
  delaySec: number;
  /** Блок в состоянии writing. В reading и dissolving давления нет. */
  active: boolean;
  /** Причины паузы, которые знает экран. Скрытую вкладку и композицию хук отслеживает сам. */
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
  const composing = useRef(false);
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

  const apply = (text: string, range: WordRange) => {
    const ta = field.current;
    // Текст поменялся или началась композиция: стирать уже нельзя, это другие слова.
    if (!ta || ta.value !== text || composing.current) return;
    // Текст меняется прямо в том же поле, без пересоздания и без blur: фокус остаётся, клавиатура не закрывается.
    // Именно через сеттер value, а не setRangeText: React следит за значением через этот сеттер, и иначе,
    // если пользователь допечатает ровно стёртое, React счёл бы ввод «без изменений» и потерял его.
    live.current.onErase(replaceText(ta, text.slice(0, range.start)));
  };

  const erase = () => {
    const ta = field.current;
    if (!ta || composing.current) return;
    dispatch({ type: 'deleted' });
    const text = ta.value;
    const range = lastWordRange(text, live.current.lang);
    // Слов нет: стирать нечего, виньетка остаётся на максимуме.
    if (!range) return;
    if (live.current.reduced) {
      apply(text, range);
      return;
    }
    const ghost = showEraseGhost(ta, range);
    const timer = setTimeout(() => {
      pending.current = null;
      apply(text, range);
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

  const composition = (on: boolean) => {
    composing.current = on;
    setPause('composition', on);
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
