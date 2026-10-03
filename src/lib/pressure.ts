import type { PressureMode } from './types';

/**
 * Режим давления (SPEC §7) как чистый автомат на подставном времени.
 * UI вызывает onActivity / pause / resume по событиям и tick(state, now) на каждом кадре.
 */

export const RAMP_MS = 5000;
export const DELETE_EVERY_MS = 400;
export const DEFAULT_DELAY_SEC = 7;
export const MIN_DELAY_SEC = 3;
export const MAX_DELAY_SEC = 30;

export type PauseReason = 'hint' | 'peek' | 'hidden' | 'modal';

export interface PressureState {
  mode: PressureMode;
  delayMs: number;
  /** Таймер стартует после первого нажатия в блоке. */
  started: boolean;
  /** Накопленное бездействие до последней паузы, мс. */
  idleBeforePause: number;
  /** Момент, с которого идёт текущий отрезок бездействия; null, пока стоит пауза. */
  runningSince: number | null;
  pauses: PauseReason[];
  /** Сколько слов уже стёрто в текущем отрезке полной виньетки. */
  deleted: number;
}

export interface TickResult {
  state: PressureState;
  /** Сила виньетки, 0..1. */
  vignette: number;
  /** Стереть последнее слово текущего блока на этом кадре. */
  deleteWord: boolean;
}

export const clampDelaySec = (sec: number) =>
  Math.min(MAX_DELAY_SEC, Math.max(MIN_DELAY_SEC, Math.round(Number.isFinite(sec) ? sec : DEFAULT_DELAY_SEC)));

/** При правке завершённого блока давление выключено полностью (SPEC §7). */
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

/** Любой keydown или input в поле письма. Сбрасывает бездействие и запускает таймер. */
export function onActivity(s: PressureState, now: number): PressureState {
  if (s.mode === 'off') return s;
  return {
    ...s,
    started: true,
    idleBeforePause: 0,
    runningSince: s.pauses.length ? null : now,
    deleted: 0,
  };
}

export function pause(s: PressureState, reason: PauseReason, now: number): PressureState {
  if (s.pauses.includes(reason)) return s;
  const idle = s.runningSince === null ? s.idleBeforePause : s.idleBeforePause + (now - s.runningSince);
  return { ...s, pauses: [...s.pauses, reason], idleBeforePause: idle, runningSince: null };
}

export function resume(s: PressureState, reason: PauseReason, now: number): PressureState {
  if (!s.pauses.includes(reason)) return s;
  const pauses = s.pauses.filter((p) => p !== reason);
  return { ...s, pauses, runningSince: pauses.length === 0 && s.started ? now : null };
}

export function idleMs(s: PressureState, now: number): number {
  return s.runningSince === null ? s.idleBeforePause : s.idleBeforePause + Math.max(0, now - s.runningSince);
}

export function tick(s: PressureState, now: number): TickResult {
  // Пока стоит пауза, виньетка скрыта, а накопленное бездействие заморожено.
  if (s.mode === 'off' || !s.started || s.pauses.length > 0) return { state: s, vignette: 0, deleteWord: false };

  const over = idleMs(s, now) - s.delayMs;
  if (over <= 0) return { state: s, vignette: 0, deleteWord: false };

  const vignette = Math.min(1, over / RAMP_MS);
  if (s.mode !== 'kamikaze' || over < RAMP_MS) return { state: s, vignette, deleteWord: false };

  // Первое слово исчезает в момент, когда виньетка дошла до 1, дальше каждые 400 мс.
  // Если кадры пропущены, догоняем по одному слову за тик, чтобы каждое успело раствориться.
  const due = Math.floor((over - RAMP_MS) / DELETE_EVERY_MS) + 1;
  if (due > s.deleted) return { state: { ...s, deleted: s.deleted + 1 }, vignette, deleteWord: true };
  return { state: s, vignette, deleteWord: false };
}

/** Убирает последнее слово вместе с пробелами и пунктуацией перед ним. Завершённые блоки сюда не передаются. */
export function dropLastWord(text: string): string {
  return text.replace(/\s*\S+\s*$/u, '');
}
