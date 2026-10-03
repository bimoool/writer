import { describe, expect, it } from 'vitest';
import { APPENDIX_A } from './__fixtures__/appendix-a';
import { extractKeyphrases, phraseTexts, targetCount, topUpKeyphrases } from './keywords';
import { segment } from './segment';
import { countWords } from './tokens';

const forText = (text: string, kind?: 'heading' | 'list-item') => phraseTexts(text, extractKeyphrases([{ text, kind }])[0]!);

describe('Приложение A, medium', () => {
  const blocks = segment(APPENDIX_A, 'medium');
  const phrases = extractKeyphrases(blocks.map((b) => ({ text: b.text, kind: b.kind })));
  const texts = blocks.map((b, i) => phraseTexts(b.text, phrases[i]!));

  it('у каждого блока 3–6 фраз в пределах нормы по длине блока', () => {
    blocks.forEach((b, i) => {
      expect(texts[i]!.length).toBeGreaterThanOrEqual(3);
      expect(texts[i]!.length).toBeLessThanOrEqual(targetCount(countWords(b.text)));
    });
  });

  it('фразы покрывают не больше 30% слов блока', () => {
    blocks.forEach((b, i) => {
      const covered = texts[i]!.reduce((a, t) => a + countWords(t), 0);
      expect(covered).toBeLessThanOrEqual(Math.floor(countWords(b.text) * 0.3));
    });
  });

  it('находит имена, термин на латинице и числа', () => {
    const all = texts.flat().join(' | ');
    expect(all).toContain('Pomodoro');
    expect(all).toContain('Франческо Чирилло');
    expect(all).toContain('25 минут');
    expect(all).toContain('25%');
    expect(all).toContain('1980-х');
  });

  it('фразы идут в порядке исходника и не пересекаются', () => {
    for (const list of phrases) {
      for (let i = 1; i < list.length; i++) expect(list[i]!.start).toBeGreaterThan(list[i - 1]!.end);
    }
  });

  it('стоп-слова не становятся фразами и не стоят по краям фраз', () => {
    for (const t of texts.flat()) {
      expect(t).not.toMatch(/^(в|и|на|что|это|который|является)\s/i);
      expect(t).not.toMatch(/\s(в|и|на|по)$/i);
    }
  });

  it('фраза не длиннее трёх слов', () => {
    for (const t of texts.flat()) expect(countWords(t)).toBeLessThanOrEqual(3);
  });
});

describe('правила отбора (SPEC §5)', () => {
  it('число фраз по длине блока: 3 / 4–5 / 6', () => {
    expect(targetCount(10)).toBe(3);
    expect(targetCount(25)).toBe(3);
    expect(targetCount(30)).toBe(4);
    expect(targetCount(45)).toBe(5);
    expect(targetCount(70)).toBe(6);
  });

  it('предлог между значимыми словами допускается внутри фразы', () => {
    const t = forText(
      'Отчёт за третий квартал вышел вчера вечером. Компания показала рост на 20%, выручка превысила прогнозы аналитиков, и акции подорожали.',
    );
    expect(t).toContain('рост на 20%');
  });

  it('при нехватке места фраза укорачивается до самого весомого слова, а не до первого', () => {
    // 12 слов, лимит 30% = 3 слова. «Франческо Чирилло» и «техника Pomodoro» придётся укоротить.
    const t = forText('Метод придумал итальянец Франческо Чирилло, позже техника Pomodoro стала популярной у студентов.');
    expect(t).toHaveLength(3);
    expect(t.every((p) => countWords(p) === 1)).toBe(true);
    // В «техника Pomodoro» латиница весит больше, значит остаётся она.
    expect(t).toContain('Pomodoro');
    expect(t).not.toContain('техника');
  });

  it('минимум 3 фразы важнее лимита 30% в коротком блоке', () => {
    const t = forText('Сон, питание и спорт помогают учиться.');
    expect(t.length).toBe(3);
  });

  it('повторённое слово не выделяется дважды', () => {
    const t = forText('Pomodoro, снова Pomodoro и опять Pomodoro: метод Pomodoro любят студенты, менеджеры и программисты.');
    expect(t.filter((p) => p.includes('Pomodoro')).length).toBe(1);
  });

  it('у короткого заголовка 1–2 фразы, а не 3', () => {
    const t = forText('Техника Pomodoro для студентов', 'heading');
    expect(t.length).toBeGreaterThanOrEqual(1);
    expect(t.length).toBeLessThanOrEqual(2);
  });

  it('заголовок из одних стоп-слов даёт 0 фраз', () => {
    expect(forText('И что это', 'heading')).toEqual([]);
  });

  it('idf: слово, которое есть во всех блоках, проигрывает редкому', () => {
    const blocks = [
      { text: 'Время важно для учёбы, его нужно беречь и планировать заранее каждый вечер.' },
      { text: 'Время уходит на соцсети, если не следить за привычками и экраном телефона.' },
      { text: 'Время можно вернуть, если выключить уведомления и работать интервалами по таймеру.' },
    ];
    const kp = extractKeyphrases(blocks);
    blocks.forEach((b, i) => {
      expect(phraseTexts(b.text, kp[i]!).some((p) => /^время$/i.test(p))).toBe(false);
    });
  });

  it('английский текст тоже размечается', () => {
    const t = forText('The Pomodoro technique was created by Francesco Cirillo in the late 1980s to fight procrastination.');
    expect(t.length).toBeGreaterThanOrEqual(3);
    expect(t.join(' ')).toMatch(/Cirillo/);
  });

  it('пустой блок не падает', () => {
    expect(forText('')).toEqual([]);
  });
});

describe('topUpKeyphrases (добор после склейки и разреза)', () => {
  const text = 'Исследования показывают, что люди, которые планируют свой день заранее, выполняют на 25% больше задач и испытывают меньше стресса.';
  const other = { text: 'Техника Pomodoro помогает поддерживать концентрацию и предотвращает умственное истощение.' };
  const range = (needle: string) => ({ start: text.indexOf(needle), end: text.indexOf(needle) + needle.length });

  it('добирает до минимума, сохраняя уже имеющиеся фразы', () => {
    const have = [range('25% больше задач')];
    const [out] = topUpKeyphrases([{ text }, other], [have, []], [0]);
    expect(out!.length).toBe(3);
    expect(phraseTexts(text, out!)).toContain('25% больше задач');
  });

  it('новые фразы не пересекаются и не касаются существующих', () => {
    const [out] = topUpKeyphrases([{ text }, other], [[range('25% больше задач')], []], [0]);
    const sorted = [...out!].sort((a, b) => a.start - b.start);
    sorted.forEach((p, i) => i && expect(p.start).toBeGreaterThan(sorted[i - 1]!.end));
  });

  it('минимум важнее лимита 30%: недостающие фразы берутся одним словом', () => {
    const [out] = topUpKeyphrases([{ text }, other], [[range('25% больше задач')], []], [0]);
    const extra = out!.filter((p) => p.start !== range('25% больше задач').start);
    expect(extra.every((p) => !/\s/.test(text.slice(p.start, p.end)))).toBe(true);
  });

  it('блок, где фраз достаточно, не меняется, даже если их больше шести', () => {
    const many = ['Исследования', 'люди', 'планируют', 'заранее', 'выполняют', '25%', 'задач', 'стресса'].map(range);
    const [out] = topUpKeyphrases([{ text }, other], [many, []], [0]);
    expect(out).toEqual(many);
  });

  it('трогает только блоки из indices', () => {
    const out = topUpKeyphrases([{ text }, other], [[], []], [1]);
    expect(out[0]).toEqual([]);
    expect(out[1]!.length).toBe(3);
  });

  it('у заголовка достаточно одной фразы', () => {
    const [out] = topUpKeyphrases([{ text: 'Техника Pomodoro', kind: 'heading' }], [[]], [0]);
    expect(out!.length).toBe(1);
  });

  it('не мутирует переданные массивы', () => {
    const have = [[range('25% больше задач')], []];
    topUpKeyphrases([{ text }, other], have, [0, 1]);
    expect(have[0]).toHaveLength(1);
    expect(have[1]).toHaveLength(0);
  });
});
