/**
 * Вычисления порциями (SPEC §15.7). Тяжёлая чистая функция пишется генератором, который отдаёт управление (`yield`) между
 * небольшими шагами. `drain` выполняет её целиком и сразу (тесты, небольшие тексты), `runSliced` отдаёт управление
 * интерфейсу, как только набежал бюджет времени, поэтому ввод и отрисовка не ждут конца вычисления.
 * Результат у обоих способов один и тот же: это один и тот же код.
 */

export type Steps<T> = Generator<void, T, void>;

/** Выполняет генератор до конца без пауз. */
export function drain<T>(steps: Steps<T>): T {
  let r = steps.next();
  while (!r.done) r = steps.next();
  return r.value;
}

/** Бюджет одной порции: меньше порога «долгой задачи» (50 мс), чтобы интерфейс не замирал. */
export const SLICE_BUDGET_MS = 8;

const later = () =>
  new Promise<void>((resolve) => {
    // Короткий таймер отдаёт управление отрисовке и вводу; requestIdleCallback в Safari нет.
    setTimeout(resolve, 0);
  });

/** Выполняет генератор порциями по SLICE_BUDGET_MS. Отмена (signal.aborted) останавливает вычисление и отклоняет промис. */
export async function runSliced<T>(steps: Steps<T>, signal?: AbortSignal, budgetMs = SLICE_BUDGET_MS): Promise<T> {
  let sliceStart = performance.now();
  for (let r = steps.next(); ; r = steps.next()) {
    if (r.done) return r.value;
    if (signal?.aborted) throw new DOMException('Отменено', 'AbortError');
    if (performance.now() - sliceStart >= budgetMs) {
      await later();
      if (signal?.aborted) throw new DOMException('Отменено', 'AbortError');
      sliceStart = performance.now();
    }
  }
}
