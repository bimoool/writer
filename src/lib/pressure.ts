import { tokenize, type Lang } from './tokens';
import type { PressureMode } from './types';

/**
 * Режим давления (SPEC §7) как чистый автомат на подставном времени.
 * Состояние меняет только reducePressure по событиям (активность, паузы, стёртое слово, смена настроек),
 * а tick(state, now) ничего не меняет и только отвечает, какая сейчас виньетка и пора ли стирать слово.
 * Время всегда приходит снаружи, поэтому всё проверяется тестами без настоящих часов.
 */

export const RAMP_MS = 5000;
export const DELETE_EVERY_MS = 400;
export const DEFAULT_DELAY_SEC = 7;
export const MIN_DELAY_SEC = 3;
export const MAX_DELAY_SEC = 30;
/** Слово растворяется столько, потом удаляется (DESIGN §6.5). */
export const WORD_FADE_MS = 300;
/** Сброс виньетки при активности. */
export const VIGNETTE_RESET_MS = 150;

/**
 * Причины паузы. Пока есть хоть одна, бездействие не копится, виньетки нет и ничего не стирается.
 * composition: идёт композиция IME или предиктивного ввода, слово ещё не дописано.
 */
export type PauseReason = 'hint' | 'peek' | 'hidden' | 'modal' | 'composition';

/**
 * Виды активности в поле письма. Таймер запускают только ввод и композиция (первый ввод в блоке),
 * клавиши и перемещение каретки только сбрасывают уже идущий отсчёт.
 */
export type ActivityKind = 'input' | 'composition' | 'key' | 'selection';

export interface PressureState {
  mode: PressureMode;
  delayMs: number;
  /** Таймер стартует после первого ввода в блоке. */
  started: boolean;
  /** Накопленное бездействие до последней паузы, мс. */
  idleBeforePause: number;
  /** Момент, с которого идёт текущий отрезок бездействия; null, пока стоит пауза или таймер не запущен. */
  runningSince: number | null;
  pauses: PauseReason[];
  /** Сколько слов уже стёрто с момента последней активности. */
  deleted: number;
}

export type PressureEvent =
  | { type: 'activity'; kind: ActivityKind; now: number }
  | { type: 'pause'; reason: PauseReason; now: number }
  | { type: 'resume'; reason: PauseReason; now: number }
  /** UI начал стирать слово (или убедился, что стирать нечего). */
  | { type: 'deleted' }
  /** Сменили режим или задержку в настройках посреди блока. */
  | { type: 'configure'; mode: PressureMode; delaySec: number; now: number };

export interface TickResult {
  /** Сила виньетки, 0..1. */
  vignette: number;
  /** Пора стереть последнее слово текущего блока. */
  deleteWord: boolean;
}

export const clampDelaySec = (sec: number) =>
  Math.min(MAX_DELAY_SEC, Math.max(MIN_DELAY_SEC, Math.round(Number.isFinite(sec) ? sec : DEFAULT_DELAY_SEC)));

/** При правке завершённого блока давление выключено полностью, в любом режиме (SPEC §7). */
export const effectiveMode = (mode: PressureMode, blockStatus: 'pending' | 'writing' | 'done'): PressureMode =>
  blockStatus === 'done' ? 'off' : mode;

export function createPressure(mode: PressureMode, delaySec: number = DEFAULT_DELAY_SEC): PressureState {
  return {
    mode,
    delayMs: clampDelaySec(delaySec) * 1000,
    started: false,
    idleBeforePause: 0,
    runningSince: null,
    pauses: [],
    deleted: 0,
  };
}

export function idleMs(s: PressureState, now: number): number {
  return s.runningSince === null ? s.idleBeforePause : s.idleBeforePause + Math.max(0, now - s.runningSince);
}

export function reducePressure(s: PressureState, e: PressureEvent): PressureState {
  switch (e.type) {
    case 'activity': {
      const starts = e.kind === 'input' || e.kind === 'composition';
      if (!s.started && !starts) return s;
      return { ...s, started: true, idleBeforePause: 0, runningSince: s.pauses.length ? null : e.now, deleted: 0 };
    }
    case 'pause': {
      if (s.pauses.includes(e.reason)) return s;
      return { ...s, pauses: [...s.pauses, e.reason], idleBeforePause: idleMs(s, e.now), runningSince: null };
    }
    case 'resume': {
      if (!s.pauses.includes(e.reason)) return s;
      const pauses = s.pauses.filter((p) => p !== e.reason);
      return { ...s, pauses, runningSince: pauses.length === 0 && s.started ? e.now : null };
    }
    case 'deleted':
      return { ...s, deleted: s.deleted + 1 };
    case 'configure': {
      const delayMs = clampDelaySec(e.delaySec) * 1000;
      if (e.mode === s.mode && delayMs === s.delayMs) return s;
      // Новые настройки начинают отсчёт заново: иначе включённое посреди блока давление сразу стирало бы слова.
      return { ...s, mode: e.mode, delayMs, idleBeforePause: 0, runningSince: s.pauses.length === 0 && s.started ? e.now : null, deleted: 0 };
    }
  }
}

export function tick(s: PressureState, now: number): TickResult {
  // Пока стоит пауза, виньетки нет, а накопленное бездействие заморожено.
  if (s.mode === 'off' || !s.started || s.pauses.length > 0) return { vignette: 0, deleteWord: false };

  const over = idleMs(s, now) - s.delayMs;
  if (over <= 0) return { vignette: 0, deleteWord: false };

  const vignette = Math.min(1, over / RAMP_MS);
  if (s.mode !== 'kamikaze' || over < RAMP_MS) return { vignette, deleteWord: false };

  // Первое слово исчезает в момент, когда виньетка дошла до 1, дальше каждые 400 мс.
  // Пропущенные кадры не стирают пачку: UI стирает по одному слову и сообщает об этом событием deleted.
  const due = Math.floor((over - RAMP_MS) / DELETE_EVERY_MS) + 1;
  return { vignette, deleteWord: due > s.deleted };
}

/** prefers-reduced-motion: виньетка меняется тремя ступенями без плавного роста. */
export const steppedVignette = (v: number) => (v <= 0 ? 0 : Math.min(1, Math.ceil(v * 3 - 1e-9) / 3));

export interface WordRange {
  /** Отсюда текст обрезается: включает пробелы перед словом. */
  start: number;
  /** Видимая часть, которая растворяется: от начала слова до конца без хвостовых пробелов. */
  chunkStart: number;
  chunkEnd: number;
  /** Всегда длина текста. */
  end: number;
}

/**
 * Последнее слово вместе с пунктуацией вокруг него и пробелами перед ним: «Привет, мир.» → « мир.».
 * Если в тексте нет ни одного слова (пусто, пробелы, одна пунктуация), стирать нечего: null.
 */
export function lastWordRange(text: string, lang?: Lang): WordRange | null {
  const tokens = tokenize(text, lang);
  const last = tokens[tokens.length - 1];
  if (!last) return null;
  let chunkStart = last.start;
  while (chunkStart > 0 && !/\s/u.test(text[chunkStart - 1]!)) chunkStart--;
  let start = chunkStart;
  while (start > 0 && /\s/u.test(text[start - 1]!)) start--;
  const chunkEnd = text.trimEnd().length;
  return { start, chunkStart, chunkEnd, end: text.length };
}

export function removeLastWord(text: string, lang?: Lang): string {
  const r = lastWordRange(text, lang);
  return r ? text.slice(0, r.start) : text;
}
