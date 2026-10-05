/** Связь с воркером орфографии. Воркер и словарь не загружаются, пока не вызван startSpell(). */

export type SpellRequest = { type: 'check'; id: number; words: string[] } | { type: 'suggest'; id: number; word: string };
export type SpellResponse =
  | { type: 'ready' }
  | { type: 'checked'; id: number; bad: string[] }
  | { type: 'suggested'; id: number; suggestions: string[] };

export interface SpellEngine {
  check(words: string[]): Promise<Set<string>>;
  suggest(word: string): Promise<string[]>;
  dispose(): void;
}

type DistributiveOmit<T, K extends string> = T extends unknown ? Omit<T, K> : never;

let loading: Promise<SpellEngine> | null = null;
let current: SpellEngine | null = null;

/** Загружает словарь (один раз) и отдаёт движок. После ошибки следующий вызов пробует заново. */
export function startSpell(): Promise<SpellEngine> {
  if (loading) return loading;
  loading = new Promise<SpellEngine>((resolve, reject) => {
    const worker = new Worker(new URL('./spellWorker.ts', import.meta.url), { type: 'module' });
    let seq = 0;
    const waiting = new Map<number, { res: (r: SpellResponse) => void; rej: (e: Error) => void }>();
    const call = <T extends SpellResponse>(req: DistributiveOmit<SpellRequest, 'id'>) =>
      new Promise<T>((res, rej) => {
        const id = ++seq;
        waiting.set(id, { res: (r) => res(r as T), rej });
        worker.postMessage({ ...req, id });
      });
    const engine: SpellEngine = {
      async check(words) {
        const r = await call<Extract<SpellResponse, { type: 'checked' }>>({ type: 'check', words });
        return new Set(r.bad);
      },
      async suggest(word) {
        const r = await call<Extract<SpellResponse, { type: 'suggested' }>>({ type: 'suggest', word });
        return r.suggestions;
      },
      dispose() {
        worker.terminate();
        if (current === engine) current = null;
        loading = null;
      },
    };
    worker.onmessage = (e: MessageEvent<SpellResponse>) => {
      const m = e.data;
      if (m.type === 'ready') {
        current = engine;
        resolve(engine);
      } else {
        waiting.get(m.id)?.res(m);
        waiting.delete(m.id);
      }
    };
    worker.onerror = () => {
      const err = new Error('spell worker failed');
      worker.terminate();
      loading = null;
      current = null;
      reject(err);
      for (const w of waiting.values()) w.rej(err);
      waiting.clear();
    };
  });
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

/** Словарь уже загружен (для тестов и состояния интерфейса). */
export const spellLoaded = () => current !== null;
