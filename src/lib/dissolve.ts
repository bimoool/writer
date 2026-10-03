/**
 * Расписание растворения блока (DESIGN §6.1). Чистые функции: сама анимация живёт в компоненте.
 *
 * Каждое слово растворяется за WORD_MS. Задержка слова = индекс × шаг + случайная добавка 0–JITTER_MS.
 * Шаг по DESIGN 22 мс, но SPEC §3.3 требует, чтобы всё растворение длилось не больше 1,1 с.
 * При шаге 22 мс блок из 30 слов закончил бы за 29 × 22 + 60 + 650 = 1348 мс, поэтому шаг сжимается
 * ровно настолько, чтобы последнее слово заканчивалось не позже MAX_DISSOLVE_MS. Это начинается
 * уже с 19 слов, а не с 31, как написано в DESIGN.
 */

export const WORD_MS = 650;
export const STEP_MS = 22;
export const JITTER_MS = 60;
export const MAX_DISSOLVE_MS = 1100;
/** Пауза между концом растворения и появлением поля письма. */
export const PAUSE_MS = 150;
export const FIELD_FADE_MS = 200;
/** При prefers-reduced-motion блок целиком гаснет за это время. */
export const REDUCED_FADE_MS = 220;
/** Появление нового блока для чтения (DESIGN §6.6). */
export const BLOCK_IN_MS = 300;
export const BLOCK_IN_SHIFT_PX = 8;

export function dissolveStep(words: number): number {
  if (words <= 1) return 0;
  return Math.min(STEP_MS, (MAX_DISSOLVE_MS - WORD_MS - JITTER_MS) / (words - 1));
}

export function dissolveDelays(words: number, random: () => number = Math.random): number[] {
  const step = dissolveStep(words);
  return Array.from({ length: words }, (_, i) => i * step + random() * JITTER_MS);
}

/** Худший случай: сколько мс пройдёт от начала до конца растворения блока из `words` слов. */
export function dissolveBound(words: number): number {
  if (words <= 0) return 0;
  return (words - 1) * dissolveStep(words) + JITTER_MS + WORD_MS;
}

/** Когда на самом деле закончится растворение с конкретными задержками. */
export const dissolveEnd = (delays: number[]) => (delays.length ? Math.max(...delays) + WORD_MS : 0);
