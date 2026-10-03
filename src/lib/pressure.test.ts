import { describe, expect, it } from 'vitest';
import {
  DELETE_EVERY_MS,
  RAMP_MS,
  clampDelaySec,
  createPressure,
  effectiveMode,
  erasableWordRange,
  idleMs,
  lastWordRange,
  reducePressure,
  cutWord,
  removeLastWord,
  shiftAfterCut,
  steppedVignette,
  tick,
  type ActivityKind,
  type CompositionRange,
  type PauseReason,
  type PressureState,
} from './pressure';
import type { PressureMode } from './types';

const DELAY = 7000;

const act = (s: PressureState, now: number, kind: ActivityKind = 'input') => reducePressure(s, { type: 'activity', kind, now });
const pause = (s: PressureState, reason: PauseReason, now: number) => reducePressure(s, { type: 'pause', reason, now });
const resume = (s: PressureState, reason: PauseReason, now: number) => reducePressure(s, { type: 'resume', reason, now });
const started = (mode: PressureMode, at = 0) => act(createPressure(mode, 7), at);

/**
 * Модель UI: тики с шагом step, на deleteWord стираем слово из text и сообщаем редьюсеру.
 * composing: в композиции последнее слово текста (так ведёт себя Gboard до пробела).
 * Возвращает моменты удалений, чтобы проверять ритм.
 */
function simulate(s: PressureState, text: string, from: number, to: number, step = 16, composing = false) {
  let state = s;
  let current = text;
  const deletedAt: number[] = [];
  let vignette = 0;
  for (let t = from; t <= to; t += step) {
    const r = tick(state, t);
    vignette = r.vignette;
    if (r.deleteWord) {
      state = reducePressure(state, { type: 'deleted' });
      const next = removeLastWord(current, 'ru', composing ? tailComposition(current) : null);
      if (next !== current) deletedAt.push(t);
      current = next;
    }
  }
  return { state, text: current, deletedAt, vignette };
}

/** Композиция на последнем фрагменте текста: «раз дв» → [4, 6). */
function tailComposition(text: string): CompositionRange {
  const m = /\S*$/u.exec(text)!;
  return { start: m.index, end: text.length };
}

describe('настройки', () => {
  it('задержка зажимается в 3–30 с, мусор даёт 7', () => {
    expect(clampDelaySec(1)).toBe(3);
    expect(clampDelaySec(99)).toBe(30);
    expect(clampDelaySec(12.4)).toBe(12);
    expect(clampDelaySec(Number.NaN)).toBe(7);
    expect(createPressure('soft').delayMs).toBe(7000);
  });

  it('done-блок: давление выключено в любом режиме', () => {
    expect(effectiveMode('kamikaze', 'done')).toBe('off');
    expect(effectiveMode('soft', 'done')).toBe('off');
    expect(effectiveMode('kamikaze', 'writing')).toBe('kamikaze');
    expect(effectiveMode('soft', 'pending')).toBe('soft');
  });
});

describe('soft', () => {
  it('таймер не идёт до первого ввода', () => {
    expect(tick(createPressure('soft'), 60_000).vignette).toBe(0);
  });

  it('стрелки и выделение до первого ввода таймер не запускают', () => {
    let s = createPressure('soft');
    s = act(s, 0, 'key');
    s = act(s, 10, 'selection');
    expect(s.started).toBe(false);
    expect(tick(s, 60_000).vignette).toBe(0);
  });

  it('композиция запускает таймер так же, как ввод', () => {
    expect(act(createPressure('soft'), 0, 'composition').started).toBe(true);
  });

  it('виньетка 0 до задержки, затем растёт до 1 за 5 с и стоит на 1', () => {
    const s = started('soft');
    expect(tick(s, DELAY).vignette).toBe(0);
    expect(tick(s, DELAY + 2500).vignette).toBeCloseTo(0.5);
    expect(tick(s, DELAY + RAMP_MS).vignette).toBe(1);
    expect(tick(s, DELAY + 60_000).vignette).toBe(1);
  });

  it('soft никогда не стирает', () => {
    const r = simulate(started('soft'), 'раз два три', 0, 60_000);
    expect(r.text).toBe('раз два три');
    expect(r.vignette).toBe(1);
  });

  it.each<ActivityKind>(['input', 'key', 'selection', 'composition'])('активность %s сбрасывает виньетку в 0', (kind) => {
    let s = started('soft');
    expect(tick(s, DELAY + 4000).vignette).toBeGreaterThan(0.5);
    s = act(s, DELAY + 4000, kind);
    expect(tick(s, DELAY + 4000).vignette).toBe(0);
    expect(tick(s, DELAY + 4000 + DELAY).vignette).toBe(0);
    expect(tick(s, DELAY + 4000 + DELAY + 2500).vignette).toBeCloseTo(0.5);
  });

  it('режим off ничего не показывает', () => {
    expect(tick(started('off'), 60_000)).toEqual({ vignette: 0, deleteWord: false });
  });
});

describe('паузы', () => {
  it.each<PauseReason>(['hint', 'peek', 'hidden', 'modal'])('%s: бездействие замирает и продолжается после снятия', (reason) => {
    let s = started('kamikaze');
    s = pause(s, reason, 3000);
    expect(tick(s, 3000 + 600_000)).toEqual({ vignette: 0, deleteWord: false });
    expect(idleMs(s, 600_000)).toBe(3000);
    s = resume(s, reason, 600_000);
    expect(tick(s, 600_000 + DELAY - 3000).vignette).toBe(0);
    expect(tick(s, 600_000 + DELAY - 3000 + 2500).vignette).toBeCloseTo(0.5);
  });

  it('на паузе kamikaze не стирает ни слова, сколько бы ни прошло', () => {
    const s = pause(started('kamikaze'), 'hint', 1000);
    const r = simulate(s, 'раз два три', 1000, 120_000, 50);
    expect(r.text).toBe('раз два три');
  });

  it('пауза при полной виньетке гасит её, снятие возвращает', () => {
    let s = started('soft');
    s = pause(s, 'hint', DELAY + RAMP_MS);
    expect(tick(s, DELAY + RAMP_MS + 10).vignette).toBe(0);
    s = resume(s, 'hint', 50_000);
    expect(tick(s, 50_000).vignette).toBe(1);
  });

  it('несколько причин: отсчёт идёт, только когда сняты все', () => {
    let s = started('soft');
    s = pause(s, 'hint', 1000);
    s = pause(s, 'hidden', 2000);
    s = resume(s, 'hint', 3000);
    expect(s.runningSince).toBeNull();
    expect(idleMs(s, 100_000)).toBe(1000);
    s = resume(s, 'hidden', 100_000);
    expect(idleMs(s, 100_500)).toBe(1500);
  });

  it('повторная пауза и снятие несуществующей паузы ничего не меняют', () => {
    const s = pause(started('soft'), 'hint', 1000);
    expect(pause(s, 'hint', 5000)).toBe(s);
    expect(resume(s, 'peek', 5000)).toBe(s);
  });

  it('активность во время паузы сбрасывает бездействие, но отсчёт стоит до снятия паузы', () => {
    let s = started('soft');
    s = pause(s, 'hint', 6000);
    s = act(s, 7000);
    expect(idleMs(s, 50_000)).toBe(0);
    s = resume(s, 'hint', 50_000);
    expect(idleMs(s, 51_000)).toBe(1000);
  });

  it('пауза до первого ввода: после снятия таймер не идёт', () => {
    let s = createPressure('soft');
    s = pause(s, 'hint', 0);
    s = resume(s, 'hint', 1000);
    expect(tick(s, 60_000).vignette).toBe(0);
  });

});

describe('композиция IME (Gboard: слово в композиции до пробела)', () => {
  it('compositionstart, compositionupdate и compositionend сбрасывают бездействие, но не ставят паузу', () => {
    let s = started('soft');
    s = act(s, 3000, 'composition'); // compositionstart
    s = act(s, 3500, 'composition'); // compositionupdate
    expect(s.pauses).toEqual([]);
    expect(tick(s, 3500 + DELAY).vignette).toBe(0);
    expect(tick(s, 3500 + DELAY + 2500).vignette).toBeCloseTo(0.5);
  });

  it('остановка посреди композиции включает давление как обычно', () => {
    // «раз два тр|»: последнее событие compositionupdate на 2000, compositionend нет
    let s = started('kamikaze');
    s = act(s, 2000, 'composition');
    expect(tick(s, 2000 + DELAY - 1).vignette).toBe(0);
    expect(tick(s, 2000 + DELAY + RAMP_MS - 1).vignette).toBeGreaterThan(0.99);
    expect(tick(s, 2000 + DELAY + RAMP_MS).deleteWord).toBe(true);
  });

  it('стирание обходит слово в композиции: уходят законченные слова перед ним', () => {
    let s = started('kamikaze');
    s = act(s, 0, 'composition');
    const at = DELAY + RAMP_MS;
    const r = simulate(s, 'раз два тр', 0, at + DELETE_EVERY_MS, 1, true);
    expect(r.deletedAt).toEqual([at, at + DELETE_EVERY_MS]);
    expect(r.text).toBe('тр');
  });

  it('единственное слово в композиции не стирается, виньетка остаётся на максимуме', () => {
    const s = act(started('kamikaze'), 0, 'composition');
    const r = simulate(s, 'тр', 0, 120_000, 50, true);
    expect(r.text).toBe('тр');
    expect(r.deletedAt).toEqual([]);
    expect(r.vignette).toBe(1);
  });

  it('композиция при правке done-блока не включает ничего', () => {
    let s = createPressure(effectiveMode('kamikaze', 'done'), 3);
    s = act(s, 0, 'composition');
    s = act(s, 500, 'composition');
    const r = simulate(s, 'уже готовый тек', 0, 300_000, 100, true);
    expect(r.text).toBe('уже готовый тек');
    expect(r.vignette).toBe(0);
  });
});

describe('kamikaze', () => {
  it('первое слово при виньетке 1, затем каждые 400 мс', () => {
    const r = simulate(started('kamikaze'), 'раз два три четыре', 0, DELAY + RAMP_MS + 1500, 1);
    expect(r.deletedAt).toEqual([DELAY + RAMP_MS, DELAY + RAMP_MS + DELETE_EVERY_MS, DELAY + RAMP_MS + 2 * DELETE_EVERY_MS, DELAY + RAMP_MS + 3 * DELETE_EVERY_MS]);
    expect(r.text).toBe('');
  });

  it('до пустого блока, дальше стирать нечего: виньетка остаётся на 1', () => {
    const r = simulate(started('kamikaze'), 'Тайм-менеджмент, по сути, это навык.', 0, 120_000);
    expect(r.text).toBe('');
    expect(r.vignette).toBe(1);
    expect(tick(r.state, 200_000).vignette).toBe(1);
  });

  it('без tick-событий deleted слово не «досчитывается» пачкой: по одному за раз', () => {
    const s = started('kamikaze');
    // кадры пропущены на 2 с: стёрто должно быть одно слово, следующее на следующем тике
    const at = DELAY + RAMP_MS + 2000;
    expect(tick(s, at).deleteWord).toBe(true);
    const after = reducePressure(s, { type: 'deleted' });
    expect(tick(after, at).deleteWord).toBe(true);
    const r = simulate(s, 'а б в г д е ж', at, at, 1);
    expect(r.deletedAt.length).toBe(1);
  });

  it('любая активность останавливает стирание сразу', () => {
    const first = simulate(started('kamikaze'), 'раз два три четыре пять', 0, DELAY + RAMP_MS + DELETE_EVERY_MS + 10, 1);
    expect(first.text).toBe('раз два три');
    const t = DELAY + RAMP_MS + DELETE_EVERY_MS + 11;
    const s = act(first.state, t, 'key');
    expect(s.deleted).toBe(0);
    expect(tick(s, t)).toEqual({ vignette: 0, deleteWord: false });
    const second = simulate(s, first.text, t, t + DELAY + RAMP_MS - 1, 1);
    expect(second.text).toBe('раз два три');
  });

  it('пустой блок с запущенным таймером ничего не ломает', () => {
    const r = simulate(started('kamikaze'), '', 0, 60_000);
    expect(r.text).toBe('');
  });
});

describe('configure', () => {
  it('смена задержки начинает отсчёт заново', () => {
    let s = started('soft');
    expect(tick(s, 10_000).vignette).toBeGreaterThan(0);
    s = reducePressure(s, { type: 'configure', mode: 'soft', delaySec: 20, now: 10_000 });
    expect(s.delayMs).toBe(20_000);
    expect(tick(s, 10_000 + 19_999).vignette).toBe(0);
    expect(tick(s, 10_000 + 22_500).vignette).toBeCloseTo(0.5);
  });

  it('выключение гасит виньетку, включение не стирает сразу', () => {
    let s = started('kamikaze');
    s = reducePressure(s, { type: 'configure', mode: 'off', delaySec: 7, now: 60_000 });
    expect(tick(s, 60_000)).toEqual({ vignette: 0, deleteWord: false });
    s = reducePressure(s, { type: 'configure', mode: 'kamikaze', delaySec: 7, now: 90_000 });
    expect(tick(s, 90_000)).toEqual({ vignette: 0, deleteWord: false });
  });

  it('те же настройки не меняют состояние', () => {
    const s = started('soft');
    expect(reducePressure(s, { type: 'configure', mode: 'soft', delaySec: 7, now: 5000 })).toBe(s);
  });

  it('во время паузы смена настроек не запускает отсчёт', () => {
    let s = pause(started('soft'), 'modal', 1000);
    s = reducePressure(s, { type: 'configure', mode: 'kamikaze', delaySec: 3, now: 2000 });
    expect(s.runningSince).toBeNull();
    s = resume(s, 'modal', 5000);
    expect(tick(s, 5000 + 2999).vignette).toBe(0);
    expect(tick(s, 5000 + 3000 + RAMP_MS).deleteWord).toBe(true);
  });
});

describe('правка done-блока', () => {
  it('эффективный режим off: ввод, бездействие и паузы ни к чему не приводят', () => {
    let s = createPressure(effectiveMode('kamikaze', 'done'), 3);
    s = act(s, 0);
    s = pause(s, 'hint', 100);
    s = resume(s, 'hint', 200);
    const r = simulate(s, 'уже готовый текст', 0, 300_000, 100);
    expect(r.text).toBe('уже готовый текст');
    expect(r.vignette).toBe(0);
  });
});

describe('чистота', () => {
  it('tick и reducePressure не мутируют состояние', () => {
    const s = started('kamikaze');
    const copy = structuredClone(s);
    tick(s, 100_000);
    reducePressure(s, { type: 'deleted' });
    reducePressure(s, { type: 'pause', reason: 'hint', now: 5 });
    act(s, 7);
    expect(s).toEqual(copy);
  });

  it('tick детерминирован: одно и то же время, один и тот же ответ', () => {
    const s = started('kamikaze');
    expect(tick(s, 12_345)).toEqual(tick(s, 12_345));
  });
});

describe('steppedVignette (reduced motion)', () => {
  it('три ступени без промежуточных значений', () => {
    expect(steppedVignette(0)).toBe(0);
    expect(steppedVignette(0.01)).toBeCloseTo(1 / 3);
    expect(steppedVignette(1 / 3)).toBeCloseTo(1 / 3);
    expect(steppedVignette(0.5)).toBeCloseTo(2 / 3);
    expect(steppedVignette(0.9)).toBe(1);
    expect(steppedVignette(1)).toBe(1);
  });
});

describe('lastWordRange и removeLastWord', () => {
  it('убирает слово с пунктуацией и пробелами перед ним', () => {
    expect(removeLastWord('Привет, мир.', 'ru')).toBe('Привет,');
    expect(removeLastWord('Привет,', 'ru')).toBe('');
    expect(removeLastWord('одно слово  ', 'ru')).toBe('одно');
    expect(removeLastWord('абзац\n\nновый', 'ru')).toBe('абзац');
  });

  it('хвост из пунктуации уходит вместе с последним словом', () => {
    expect(removeLastWord('Начало — конец —', 'ru')).toBe('Начало —');
    expect(removeLastWord('числа 25% и 1980-х', 'ru')).toBe('числа 25% и');
    expect(removeLastWord('ссылка https://example.com/a?b=1', 'en')).toBe('ссылка');
  });

  it('нет слов: стирать нечего', () => {
    expect(lastWordRange('', 'ru')).toBeNull();
    expect(lastWordRange('   \n ', 'ru')).toBeNull();
    expect(lastWordRange('... — !', 'ru')).toBeNull();
    expect(removeLastWord('... — !', 'ru')).toBe('... — !');
  });

  it('границы для растворения: видимая часть без пробелов', () => {
    const text = 'раз два, ';
    expect(lastWordRange(text, 'ru')).toEqual({ start: 3, chunkStart: 4, chunkEnd: 8, end: 9 });
    expect(text.slice(4, 8)).toBe('два,');
  });

  it('с композицией: пробел перед словом в композиции остаётся, первое слово уходит без пробела', () => {
    expect(removeLastWord('раз два тр', 'ru', { start: 8, end: 10 })).toBe('раз тр');
    expect(removeLastWord('раз тр', 'ru', { start: 4, end: 6 })).toBe('тр');
    expect(removeLastWord('Привет, мир. Ка', 'ru', { start: 13, end: 15 })).toBe('Привет, Ка');
    expect(removeLastWord('абзац\n\nновое сл', 'ru', { start: 13, end: 15 })).toBe('абзац\n\nсл');
  });

  it('с композицией: защищён весь фрагмент между пробелами, в котором она идёт', () => {
    // Композиция «тр» прилеплена к «раз,»: фрагмент «раз,тр» не дописан целиком
    expect(erasableWordRange('один раз,тр', { start: 9, end: 11 }, 'ru')).toEqual({ start: 0, chunkStart: 0, chunkEnd: 4, end: 5 });
    expect(removeLastWord('один раз,тр', 'ru', { start: 9, end: 11 })).toBe('раз,тр');
    expect(erasableWordRange('раз,тр', { start: 4, end: 6 }, 'ru')).toBeNull();
  });

  it('с композицией посреди текста: текст после неё не трогается', () => {
    // Каретку вернули в середину: «раз два тр| три»
    const text = 'раз два тр три';
    const r = erasableWordRange(text, { start: 8, end: 10 }, 'ru')!;
    expect(text.slice(r.chunkStart, r.chunkEnd)).toBe('два');
    expect(cutWord(text, r)).toBe('раз тр три');
    expect(shiftAfterCut(10, r)).toBe(6);
    expect(shiftAfterCut(2, r)).toBe(2);
  });

  it('пустая композиция в начале или пробелы перед ней: стирать нечего', () => {
    expect(erasableWordRange('', { start: 0, end: 0 }, 'ru')).toBeNull();
    expect(erasableWordRange('  тр', { start: 2, end: 4 }, 'ru')).toBeNull();
    expect(erasableWordRange('— тр', { start: 2, end: 4 }, 'ru')).toBeNull();
  });

  it('каждое удаление убирает ровно одно слово, пока они есть', () => {
    let t = 'Один, два — три четыре.';
    const seen: string[] = [];
    while (lastWordRange(t, 'ru')) {
      t = removeLastWord(t, 'ru');
      seen.push(t);
    }
    expect(seen).toEqual(['Один, два — три', 'Один, два —', 'Один,', '']);
  });
});

describe('emoji и составные символы', () => {
  it('стирание режет по границам слов и не ломает суррогатные пары', () => {
    const cases = ['Привет 👋 мир 🇷🇺', 'Семья 👨‍👩‍👧‍👦 дома', 'раз два 😀😀😀', 'один 🙂'];
    for (const text of cases) {
      let t = text;
      for (let i = 0; i < 6 && lastWordRange(t, 'ru'); i++) {
        t = removeLastWord(t, 'ru');
        expect(t).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/);
      }
      expect(lastWordRange(t, 'ru')).toBeNull();
    }
  });

  it('emoji без слов: стирать нечего', () => {
    expect(lastWordRange('😀😀😀', 'ru')).toBeNull();
    expect(removeLastWord('👨‍👩‍👧‍👦 🙂', 'ru')).toBe('👨‍👩‍👧‍👦 🙂');
  });
});
