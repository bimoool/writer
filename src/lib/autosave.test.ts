import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutosaver, pickNewer } from './autosave';

interface Item {
  id: string;
  v: number;
}

function setup(save = vi.fn<(items: Item[]) => Promise<void>>().mockResolvedValue(undefined)) {
  const onError = vi.fn();
  const onSaved = vi.fn();
  const saver = createAutosaver<Item>({ save, getId: (i) => i.id, onError, onSaved });
  return { saver, save, onError, onSaved };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('createAutosaver', () => {
  it('debounce 500 мс: серия правок даёт одну запись с последней версией', async () => {
    const { saver, save } = setup();
    for (let v = 1; v <= 5; v++) {
      saver.schedule({ id: 'a', v });
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith([{ id: 'a', v: 5 }]);
  });

  it('при непрерывном наборе пишет не реже раза в 2 с (maxWait)', async () => {
    const { saver, save } = setup();
    // Нажатие каждые 150 мс в течение 5 с: debounce сам по себе не сработал бы ни разу.
    for (let t = 0; t < 5000; t += 150) {
      saver.schedule({ id: 'a', v: t });
      await vi.advanceTimersByTimeAsync(150);
    }
    expect(save.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(save.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('flush пишет сразу, не дожидаясь таймера', async () => {
    const { saver, save } = setup();
    saver.schedule({ id: 'a', v: 1 });
    saver.schedule({ id: 'b', v: 1 });
    await saver.flush();
    expect(save).toHaveBeenCalledWith([
      { id: 'a', v: 1 },
      { id: 'b', v: 1 },
    ]);
    expect(saver.hasPending()).toBe(false);
  });

  it('не запускает две записи одновременно; правки во время записи уходят следующей', async () => {
    let release!: () => void;
    const save = vi.fn<(items: Item[]) => Promise<void>>().mockImplementationOnce(() => new Promise((r) => (release = r)));
    save.mockResolvedValue(undefined);
    const { saver } = setup(save);
    saver.schedule({ id: 'a', v: 1 });
    const first = saver.flush();
    saver.schedule({ id: 'a', v: 2 });
    const second = saver.flush();
    expect(save).toHaveBeenCalledTimes(1);
    release();
    await first;
    await second;
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]![0]).toEqual([{ id: 'a', v: 2 }]);
  });

  it('ошибка записи: версия остаётся в очереди, сообщается и повторяется с нарастающей паузой', async () => {
    const save = vi.fn<(items: Item[]) => Promise<void>>().mockRejectedValueOnce(new Error('quota')).mockRejectedValueOnce(new Error('quota'));
    save.mockResolvedValue(undefined);
    const { saver, onError, onSaved } = setup(save);
    saver.schedule({ id: 'a', v: 1 });
    await saver.flush();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(saver.pending()).toEqual([{ id: 'a', v: 1 }]);

    await vi.advanceTimersByTimeAsync(2000); // первая повторная попытка, снова ошибка
    expect(save).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3999); // вторая пауза уже 4 с
    expect(save).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(3);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(saver.hasPending()).toBe(false);
  });

  it('после ошибки более новая версия не затирается старой', async () => {
    let fail!: (e: Error) => void;
    const save = vi.fn<(items: Item[]) => Promise<void>>().mockImplementationOnce(() => new Promise((_, rej) => (fail = rej)));
    save.mockResolvedValue(undefined);
    const { saver } = setup(save);
    saver.schedule({ id: 'a', v: 1 });
    const p = saver.flush();
    saver.schedule({ id: 'a', v: 2 });
    fail(new Error('boom'));
    await p;
    expect(saver.pending()).toEqual([{ id: 'a', v: 2 }]);
  });

  it('pending включает пачку, которая пишется сейчас, пока запись не завершилась', async () => {
    let release!: () => void;
    const save = vi.fn<(items: Item[]) => Promise<void>>().mockImplementationOnce(() => new Promise((r) => (release = r)));
    save.mockResolvedValue(undefined);
    const { saver } = setup(save);
    saver.schedule({ id: 'a', v: 1 });
    const p = saver.flush();
    saver.schedule({ id: 'b', v: 1 });
    saver.schedule({ id: 'a', v: 2 }); // новая версия документа, который пишется
    expect([...saver.pending()].sort((x, y) => x.id.localeCompare(y.id))).toEqual([
      { id: 'a', v: 2 },
      { id: 'b', v: 1 },
    ]);
    release();
    await p;
    await saver.flush();
    expect(saver.pending()).toEqual([]);
  });

  it('cancel убирает документ из очереди', async () => {
    const { saver, save } = setup();
    saver.schedule({ id: 'a', v: 1 });
    saver.cancel('a');
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).not.toHaveBeenCalled();
  });
});

describe('pickNewer', () => {
  it('аварийный снимок побеждает, только если он свежее', () => {
    const stored = [
      { id: 'a', updatedAt: 10 },
      { id: 'b', updatedAt: 50 },
    ];
    const rescued = [
      { id: 'a', updatedAt: 20 },
      { id: 'b', updatedAt: 40 },
      { id: 'c', updatedAt: 5 },
    ];
    const { merged, restored } = pickNewer(stored, rescued);
    expect(restored.map((d) => d.id)).toEqual(['a', 'c']);
    expect(merged.find((d) => d.id === 'a')!.updatedAt).toBe(20);
    expect(merged.find((d) => d.id === 'b')!.updatedAt).toBe(50);
  });
});
