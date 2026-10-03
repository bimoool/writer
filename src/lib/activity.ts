/**
 * Активное время на блоке. Считаем от события до события, но не больше IDLE_CAP_MS за один промежуток:
 * забытый на столе телефон не должен набегать часами. Скрытая вкладка время не копит
 * (при возврате отсчёт начинается заново с last = null).
 */
export const IDLE_CAP_MS = 60_000;

export function advance(last: number | null, now: number, cap: number = IDLE_CAP_MS): { ms: number; last: number } {
  if (last === null) return { ms: 0, last: now };
  return { ms: Math.min(Math.max(0, now - last), cap), last: now };
}
