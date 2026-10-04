import { afterEach, describe, expect, it } from 'vitest';
import { createTabLock, type TabLock } from './tabLock';

const opened: TabLock[] = [];
const open = (release: () => Promise<void>, name: string) => {
  const t = createTabLock({ release, channelName: name, helloMs: 30, releaseMs: 500 });
  opened.push(t);
  return t;
};
afterEach(() => opened.splice(0).forEach((t) => t.close()));

describe('одна рабочая вкладка', () => {
  it('без других вкладок запуск не ждёт дольше окна приветствия', async () => {
    const t0 = Date.now();
    await open(async () => undefined, `c-${Math.random()}`).claim();
    expect(Date.now() - t0).toBeLessThan(300);
  });

  it('новая вкладка загружается только после того, как старая дописала очередь и замерла', async () => {
    const name = `c-${Math.random()}`;
    const events: string[] = [];
    open(async () => {
      events.push('old: release start');
      await new Promise((r) => setTimeout(r, 100));
      events.push('old: flushed');
    }, name);
    await open(async () => undefined, name).claim();
    events.push('new: hydrate');
    expect(events).toEqual(['old: release start', 'old: flushed', 'new: hydrate']);
  });

  it('зависшая старая вкладка не блокирует запуск дольше предела', async () => {
    const name = `c-${Math.random()}`;
    open(() => new Promise<void>(() => undefined), name);
    const t0 = Date.now();
    await open(async () => undefined, name).claim();
    expect(Date.now() - t0).toBeGreaterThanOrEqual(500);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('release вызывается один раз, даже если вкладок открыли несколько', async () => {
    const name = `c-${Math.random()}`;
    let calls = 0;
    open(async () => void calls++, name);
    await open(async () => undefined, name).claim();
    await open(async () => undefined, name).claim();
    expect(calls).toBe(1);
  });
});
