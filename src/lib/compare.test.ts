import { describe, expect, it } from 'vitest';
import { buildCheckText, buildSourceCheckText } from './checkText';
import { carriedPhrases, compareTexts } from './compare';

type B = { id: string; paragraphIndex: number; kind: 'text'; sourceText: string; userText: string };
const blocks = (pairs: Array<[string, string]>): B[] => pairs.map(([sourceText, userText], i) => ({ id: `b${i}`, paragraphIndex: i, kind: 'text', sourceText, userText }));
const run = (pairs: Array<[string, string]>) => {
  const b = blocks(pairs);
  const source = buildSourceCheckText(b);
  const user = buildCheckText(b);
  return { source, user, result: compareTexts(source, user) };
};

describe('перенесённые фразы', () => {
  it('четыре слова подряд, одинаковые по основам, находятся', () => {
    const { user, result } = run([['Мы работаем короткими интервалами по двадцать пять минут.', 'Я тоже работаю короткими интервалами по полчаса.']]);
    expect(result.phrases).toHaveLength(1);
    expect(user.text.slice(result.phrases[0]!.start, result.phrases[0]!.end)).toBe('работаю короткими интервалами по');
    expect(result.phrases[0]!.words).toBe(4);
  });
  it('три слова — мало', () => {
    const { result } = run([['Мы работаем короткими интервалами.', 'Я работаю короткими интервалами.']]);
    expect(result.phrases).toEqual([]);
  });
  it('регистр, ё и пунктуация не мешают', () => {
    const { result } = run([['Ёлка, стоящая В ЛЕСУ, очень высокая.', 'елка стоящая в лесу очень старая']]);
    expect(result.phrases).toHaveLength(1);
    expect(result.phrases[0]!.words).toBeGreaterThanOrEqual(4);
  });
  it('длинный отрезок — одна фраза, а не несколько', () => {
    const t = 'Люди которые планируют день заранее делают больше и меньше нервничают';
    const { result } = run([[t, t]]);
    expect(result.phrases).toHaveLength(1);
    expect(result.phrases[0]!.words).toBe(t.split(' ').length);
  });
  it('фразы из одних стоп-слов не считаются', () => {
    const { result } = run([['Это то что и так как это.', 'Это то что и так как это.']]);
    expect(result.phrases).toEqual([]);
  });
  it('показывает блок исходника и место фразы в нём', () => {
    const { result } = run([
      ['Первый блок исходника совсем про другое.', 'Моё про своё.'],
      ['Здесь работают короткими интервалами по двадцать пять минут подряд.', 'Так работают короткими интервалами по полчаса.'],
    ]);
    const p = result.phrases[0]!;
    expect(p.source.blockId).toBe('b1');
    expect(p.source.text.slice(p.source.start, p.source.end)).toBe('работают короткими интервалами по');
  });
  it('топ блоков по числу перенесённых фраз, не больше трёх', () => {
    const same = 'Один из самых популярных подходов к планированию дня';
    const { result } = run([
      [same + ' и ещё один подход к делу', same + ' и ещё один подход к делу. Один из самых популярных подходов к планированию дня'],
      [same, same],
      [same, 'своё совсем'],
      [same, same],
      [same, same],
    ]);
    expect(result.topBlocks.length).toBeLessThanOrEqual(3);
    expect(result.topBlocks[0]!.blockId).toBe('b0');
    expect(result.topBlocks.every((b) => b.count > 0)).toBe(true);
    expect(result.topBlocks.map((b) => b.blockId)).not.toContain('b2');
  });
  it('своё сравнение: ничего общего', () => {
    const { result } = run([['Исследования показывают пользу планирования дня заранее.', 'Я заметил, что с планом мне спокойнее и легче.']]);
    expect(result.phrases).toEqual([]);
    expect(result.status).toBe('ok');
  });
  it('функция отдельно: короткие тексты', () => {
    const b = blocks([['раз два', 'раз два']]);
    expect(carriedPhrases(buildSourceCheckText(b), buildCheckText(b))).toEqual([]);
  });
});

describe('шаблоны, перешедшие из исходника', () => {
  it('сработало в обоих: подсвечивается в тексте пользователя', () => {
    const { user, result } = run([['Важно отметить, что метода нет.', 'Важно отметить: у меня другой путь.']]);
    expect(result.carriedPatterns.map((f) => [f.ruleId, user.text.slice(f.start, f.end), f.sourceExample])).toEqual([['important-note', 'Важно отметить', 'Важно отметить']]);
    expect(result.gonePatterns).toEqual([]);
  });
  it('только в исходнике: в списке «убрано»', () => {
    const { result } = run([['В современном мире время дорого. Важно отметить это.', 'Время дорого, и я его считаю.']]);
    expect(result.carriedPatterns).toEqual([]);
    expect(result.gonePatterns.map((g) => g.ruleId).sort()).toEqual(['important-note', 'modern-world']);
  });
  it('только у пользователя: ни там, ни там не показывается', () => {
    const { result } = run([['Время дорого.', 'Важно отметить, время дорого.']]);
    expect(result.carriedPatterns).toEqual([]);
    expect(result.gonePatterns).toEqual([]);
  });
});

describe('особые случаи', () => {
  it('пустой исходник: ничего не считаем', () => {
    expect(run([['', 'Мой текст о планах на день.']]).result).toMatchObject({ status: 'noSource', phrases: [], carriedPatterns: [] });
  });
  it('пустой текст пользователя', () => {
    expect(run([['Исходный текст о планах на день.', '']]).result.status).toBe('noText');
  });
  it('одни стоп-слова', () => {
    expect(run([['и в на с', 'и в на с']]).result.phrases).toEqual([]);
  });
  it('одно предложение', () => {
    expect(run([['Мы любим чай.', 'Мы любим кофе.']]).result.status).toBe('ok');
  });
});
