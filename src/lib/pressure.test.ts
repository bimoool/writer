import { describe, expect, it } from 'vitest';
import {
  DELETE_EVERY_MS,
  RAMP_MS,
  clampDelaySec,
  createPressure,
  dropLastWord,
  effectiveMode,
  onActivity,
  pause,
  resume,
  tick,
  type PressureState,
} from './pressure';

const DELAY = 7000;

/** Прогоняет тики с шагом step от from до to и собирает удаления. */
function run(s: PressureState, from: number, to: number, step = 16) {
  let state = s;
  let deletes = 0;
  let vignette = 0;
  for (let t = from; t <= to; t += step) {
    const r = tick(state, t);
    state = r.state;
    vignette = r.vignette;
    if (r.deleteWord) deletes++;
  }
  return { state, deletes, vignette };
}

describe('soft', () => {
  it('таймер не идёт до первого нажатия', () => {
    const s = createPressure('soft');
    expect(tick(s, 60_000).vignette).toBe(0);
  });

  it('виньетка 0 до задержки, затем растёт до 1 за 5 с', () => {
    const s = onActivity(createPressure('soft', 7), 0);
    expect(tick(s, DELAY).vignette).toBe(0);
    expect(tick(s, DELAY + RAMP_MS / 2).vignette).toBeCloseTo(0.5, 5);
    expect(tick(s, DELAY + RAMP_MS).vignette).toBe(1);
    expect(tick(s, DELAY + RAMP_MS * 3).vignette).toBe(1);
  });

  it('любая активность сбрасывает виньетку', () => {
    let s = onActivity(createPressure('soft'), 0);
    expect(tick(s, DELAY + 3000).vignette).toBeGreaterThan(0);
    s = onActivity(s, DELAY + 3000);
    expect(tick(s, DELAY + 3001).vignette).toBe(0);
  });

  it('soft никогда не стирает слова', () => {
    const s = onActivity(createPressure('soft'), 0);
    expect(run(s, 0, 30_000).deletes).toBe(0);
  });
});

describe('kamikaze', () => {
  it('после полной виньетки стирает по слову каждые 400 мс', () => {
    const s = onActivity(createPressure('kamikaze'), 0);
    const full = DELAY + RAMP_MS;
    expect(run(s, 0, full - 1).deletes).toBe(0);
    // На полной виньетке сразу одно слово, затем ещё по одному каждые 400 мс.
    expect(run(s, 0, full + DELETE_EVERY_MS * 5).deletes).toBe(6);
  });

  it('при пропущенных кадрах догоняет по одному слову за тик', () => {
    const s = onActivity(createPressure('kamikaze'), 0);
    const late = DELAY + RAMP_MS + DELETE_EVERY_MS * 10;
    const r1 = tick(s, late);
    const r2 = tick(r1.state, late);
    expect(r1.deleteWord).toBe(true);
    expect(r2.deleteWord).toBe(true);
    expect(r2.state.deleted).toBe(2);
  });

  it('активность останавливает стирание', () => {
    const s = onActivity(createPressure('kamikaze'), 0);
    const full = DELAY + RAMP_MS;
    const a = run(s, 0, full + 1000);
    const after = onActivity(a.state, full + 1000);
    expect(run(after, full + 1000, full + 1000 + DELAY - 16).deletes).toBe(0);
  });
});

describe('паузы (SPEC §7)', () => {
  it('открытая подсказка замораживает таймер и прячет виньетку', () => {
    let s = onActivity(createPressure('kamikaze'), 0);
    s = pause(s, 'hint', 5000);
    expect(run(s, 5000, 60_000).deletes).toBe(0);
    expect(tick(s, 60_000).vignette).toBe(0);
    // После закрытия отсчёт продолжается с 5 с, а не с нуля и не с 60.
    s = resume(s, 'hint', 60_000);
    expect(tick(s, 60_000 + 1999).vignette).toBe(0);
    expect(tick(s, 60_000 + 2000 + RAMP_MS / 2).vignette).toBeCloseTo(0.5, 5);
  });

  it('несколько причин паузы: таймер идёт, только когда сняты все', () => {
    let s = onActivity(createPressure('soft'), 0);
    s = pause(s, 'peek', 1000);
    s = pause(s, 'hidden', 1500);
    s = resume(s, 'peek', 2000);
    expect(tick(s, 100_000).vignette).toBe(0);
    s = resume(s, 'hidden', 100_000);
    expect(tick(s, 100_000 + DELAY - 1000 + RAMP_MS).vignette).toBe(1);
  });

  it('скрытая вкладка и модальное окно тоже ставят паузу', () => {
    for (const reason of ['hidden', 'modal'] as const) {
      const s = pause(onActivity(createPressure('kamikaze'), 0), reason, 1);
      expect(run(s, 1, 40_000).deletes).toBe(0);
    }
  });

  it('нажатие во время паузы не запускает таймер до снятия паузы', () => {
    let s = pause(createPressure('soft'), 'hint', 0);
    s = onActivity(s, 100);
    expect(tick(s, 50_000).vignette).toBe(0);
    s = resume(s, 'hint', 50_000);
    expect(tick(s, 50_000 + DELAY + RAMP_MS).vignette).toBe(1);
  });
});

describe('выключенный режим и завершённые блоки', () => {
  it('off ничего не делает', () => {
    const s = onActivity(createPressure('off'), 0);
    const r = run(s, 0, 60_000);
    expect(r.vignette).toBe(0);
    expect(r.deletes).toBe(0);
  });

  it('при правке done-блока давление выключено в любом режиме', () => {
    expect(effectiveMode('kamikaze', 'done')).toBe('off');
    expect(effectiveMode('soft', 'done')).toBe('off');
    expect(effectiveMode('kamikaze', 'writing')).toBe('kamikaze');
    const s = onActivity(createPressure(effectiveMode('kamikaze', 'done')), 0);
    expect(run(s, 0, 60_000).deletes).toBe(0);
  });

  it('задержка ограничена 3..30 с', () => {
    expect(clampDelaySec(1)).toBe(3);
    expect(clampDelaySec(100)).toBe(30);
    expect(clampDelaySec(Number.NaN)).toBe(7);
    expect(createPressure('soft', 12).delayMs).toBe(12_000);
  });
});

describe('dropLastWord', () => {
  it('убирает последнее слово с пунктуацией', () => {
    expect(dropLastWord('Есть такой метод, Pomodoro.')).toBe('Есть такой метод,');
    expect(dropLastWord('Одно')).toBe('');
    expect(dropLastWord('')).toBe('');
  });
});
