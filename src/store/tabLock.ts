/**
 * Одна рабочая вкладка. Каждая вкладка держит документ целиком в памяти и пишет его в IndexedDB целиком, поэтому
 * забытая старая вкладка при любом изменении (даже при учёте времени, когда на неё просто переключились)
 * записала бы устаревшую версию поверх текста, написанного в новой.
 *
 * Новая вкладка при запуске объявляет себя («claim»). Остальные сразу отвечают «busy», дописывают свою очередь
 * сохранения, замирают (больше ничего не пишут) и отвечают «released». Новая вкладка загружает документы только
 * после этого, так что видит всё, что старые успели набрать.
 */

type Message = { type: 'claim' | 'busy' | 'released'; from: string; to?: string };

export interface TabLockOptions {
  /** Вызывается синхронно при появлении новой вкладки: перестать писать и дописать очередь сохранения. */
  release: () => Promise<void>;
  channelName?: string;
  /** Сколько ждать ответа «busy», прежде чем решить, что других вкладок нет. */
  helloMs?: number;
  /** Предел ожидания «released»: зависшая вкладка не должна блокировать запуск. */
  releaseMs?: number;
}

export interface TabLock {
  /** Объявить вкладку рабочей. Резолвится, когда остальные вкладки дописали своё и замерли. */
  claim(): Promise<void>;
  close(): void;
}

export function createTabLock(opts: TabLockOptions): TabLock {
  const id = Math.random().toString(36).slice(2);
  const helloMs = opts.helloMs ?? 150;
  const releaseMs = opts.releaseMs ?? 2000;
  // Без BroadcastChannel (старые браузеры) защиты нет, но и запуск не задерживается.
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(opts.channelName ?? 'svoimi:tabs') : null;
  let released: Promise<void> | null = null;
  let onReply: ((msg: Message) => void) | null = null;

  if (channel)
    channel.onmessage = (e: MessageEvent<Message>) => {
      const msg = e.data;
      if (!msg || msg.from === id) return;
      if (msg.type === 'claim') {
        channel.postMessage({ type: 'busy', from: id, to: msg.from } satisfies Message);
        const reply = () => channel.postMessage({ type: 'released', from: id, to: msg.from } satisfies Message);
        released ??= opts.release();
        released.then(reply, reply);
      } else if (msg.to === id) {
        onReply?.(msg);
      }
    };

  return {
    claim() {
      if (!channel) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const busy = new Set<string>();
        let done = false;
        let limit: ReturnType<typeof setTimeout> | undefined;
        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(hello);
          clearTimeout(limit);
          onReply = null;
          resolve();
        };
        const hello = setTimeout(() => {
          if (busy.size === 0) finish();
          else limit = setTimeout(finish, releaseMs);
        }, helloMs);
        onReply = (msg) => {
          if (msg.type === 'busy') busy.add(msg.from);
          else if (msg.type === 'released') {
            busy.delete(msg.from);
            // Пока не истекло окно приветствия, могут ответить ещё вкладки.
            if (busy.size === 0 && limit !== undefined) finish();
          }
        };
        channel.postMessage({ type: 'claim', from: id } satisfies Message);
      });
    },
    close() {
      channel?.close();
    },
  };
}
