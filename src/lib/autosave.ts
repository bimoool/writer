/**
 * Автосохранение (SPEC §4): debounce 500 мс плюс принудительный flush
 * на visibilitychange / pagehide / beforeunload.
 *
 * - Изменения копятся по id, последняя версия документа побеждает.
 * - maxWait: при непрерывном наборе запись всё равно происходит не реже раза в 2 с,
 *   иначе debounce откладывал бы её бесконечно.
 * - Одновременно идёт не больше одной записи. Изменения во время записи ждут следующей.
 * - При ошибке записи версии возвращаются в очередь (если их не обогнали более новые),
 *   и через retryMs делается повторная попытка с удвоением паузы до 30 с.
 */

export interface Autosaver<T> {
  schedule(item: T): void;
  /** Записать всё накопленное сейчас. Резолвится, когда очередь пуста или запись упала. */
  flush(): Promise<void>;
  /** Убрать документ из очереди (например, при удалении). */
  cancel(id: string): void;
  /** Несохранённые версии (очередь и пачка, которая пишется прямо сейчас): для аварийного снимка при закрытии вкладки. */
  pending(): T[];
  hasPending(): boolean;
  dispose(): void;
}

export interface AutosaverOptions<T> {
  save: (items: T[]) => Promise<void>;
  getId: (item: T) => string;
  delayMs?: number;
  maxWaitMs?: number;
  retryMs?: number;
  maxRetryMs?: number;
  onSaved?: () => void;
  onError?: (error: unknown) => void;
}

export function createAutosaver<T>(opts: AutosaverOptions<T>): Autosaver<T> {
  const delay = opts.delayMs ?? 500;
  const maxWait = opts.maxWaitMs ?? 2000;
  const baseRetry = opts.retryMs ?? 2000;
  const maxRetry = opts.maxRetryMs ?? 30_000;

  let queue = new Map<string, T>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let firstChangeAt: number | null = null;
  let inFlight: Promise<void> | null = null;
  /** Пачка, которая пишется сейчас: транзакцию может оборвать закрытие вкладки, так что она ещё не считается сохранённой. */
  let writing: Map<string, T> | null = null;
  let retry = baseRetry;
  let disposed = false;

  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const arm = (ms: number) => {
    clear();
    timer = setTimeout(() => {
      timer = null;
      void run();
    }, ms);
  };

  async function run(): Promise<void> {
    if (inFlight) {
      await inFlight;
      return queue.size ? run() : undefined;
    }
    if (queue.size === 0 || disposed) return;
    clear();
    firstChangeAt = null;
    const batch = queue;
    queue = new Map();
    writing = batch;

    let failed = false;
    inFlight = opts
      .save([...batch.values()])
      .then(
        () => {
          inFlight = null;
          writing = null;
          retry = baseRetry;
          opts.onSaved?.();
        },
        (error: unknown) => {
          inFlight = null;
          writing = null;
          failed = true;
          // Возвращаем в очередь только то, что не успели обновить во время записи.
          for (const [id, item] of batch) if (!queue.has(id)) queue.set(id, item);
          opts.onError?.(error);
        },
      );
    await inFlight;

    if (failed) {
      if (!disposed) arm(retry);
      retry = Math.min(retry * 2, maxRetry);
    } else if (queue.size && timer === null) {
      arm(delay);
    }
  }

  return {
    schedule(item) {
      if (disposed) return;
      queue.set(opts.getId(item), item);
      const now = Date.now();
      firstChangeAt ??= now;
      const waited = now - firstChangeAt;
      arm(Math.max(0, Math.min(delay, maxWait - waited)));
    },
    flush: () => run(),
    cancel(id) {
      queue.delete(id);
      if (queue.size === 0) {
        clear();
        firstChangeAt = null;
      }
    },
    pending: () => [...[...(writing ?? [])].filter(([id]) => !queue.has(id)).map(([, item]) => item), ...queue.values()],
    hasPending: () => queue.size > 0 || inFlight !== null,
    dispose() {
      disposed = true;
      clear();
    },
  };
}

/**
 * Слияние аварийного снимка (localStorage, записан синхронно при закрытии вкладки)
 * с тем, что успело попасть в IndexedDB: побеждает более свежий updatedAt.
 */
export function pickNewer<T extends { id: string; updatedAt: number }>(stored: T[], rescued: T[]): { merged: T[]; restored: T[] } {
  const byId = new Map(stored.map((d) => [d.id, d]));
  const restored: T[] = [];
  for (const r of rescued) {
    const s = byId.get(r.id);
    if (!s || r.updatedAt > s.updatedAt) {
      byId.set(r.id, r);
      restored.push(r);
    }
  }
  return { merged: [...byId.values()], restored };
}
