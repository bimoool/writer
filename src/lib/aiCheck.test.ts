import { describe, expect, it } from 'vitest';
import { findPatterns } from './aiCheck';
import { PHRASE_RULES, type PhraseRule } from './aiPatterns';
import { buildCheckText } from './checkText';

const check = (text: string) => buildCheckText(text.split('\n\n').map((t, i) => ({ id: `b${i}`, paragraphIndex: i, kind: 'text' as const, userText: t })));
const ids = (text: string) => findPatterns(check(text)).map((f) => f.ruleId);
const slices = (text: string, id: string) => findPatterns(check(text)).filter((f) => f.ruleId === id).map((f) => text.slice(f.start, f.end));

describe('фразовые правила', () => {
  const positive: Array<[string, string]> = [
    ['important-note', 'Важно отметить, что это работает.'],
    ['worth-noting', 'Здесь стоит отметить один факт.'],
    ['modern-world', 'В современном мире всё быстро.'],
    ['our-time', 'В наше время все спешат.'],
    ['key-role', 'Сон играет ключевую роль в обучении.'],
    ['key-role', 'Привычки играют важную роль.'],
    ['is-the-key', 'Практика является ключом к успеху.'],
    ['in-conclusion', 'В заключение скажу пару слов.'],
    ['thus', 'Первый абзац.\n\nТаким образом, всё ясно.'],
    ['not-just', 'Это не просто навык, а образ жизни.'],
    ['not-only', 'Он не только пишет, но и рисует.'],
  ];
  for (const [id, text] of positive) {
    it(`находит ${id}: «${text}»`, () => expect(ids(text)).toContain(id));
  }

  const negative: Array<[string, string]> = [
    ['important-note', 'Это важно, и я это отмечу.'],
    ['modern-world', 'Мир стал современнее.'],
    ['our-time', 'Время наше, и оно идёт.'],
    ['key-role', 'Он играет в футбол и играет на гитаре.'],
    ['in-conclusion', 'Он вышел из заключения рано утром.'],
    ['thus', 'Мы решили так, и таким образом всё сложилось.'],
    ['not-just', 'Он не просто сидел.'],
    ['not-only', 'Он не только пришёл рано.'],
  ];
  for (const [id, text] of negative) {
    it(`не находит ${id}: «${text}»`, () => expect(ids(text)).not.toContain(id));
  }

  it('«таким образом» в начале абзаца, но не в середине', () => {
    expect(slices('Таким образом, готово.', 'thus')).toEqual(['Таким образом']);
    expect(slices('Готово. Таким образом, всё.', 'thus')).toEqual([]);
  });
  it('не зависит от регистра и ё', () => {
    expect(slices('ВАЖНО ОТМЕТИТЬ это.', 'important-note')).toEqual(['ВАЖНО ОТМЕТИТЬ']);
  });
  it('выделяет саму конструкцию', () => {
    expect(slices('Это не просто навык, а образ жизни.', 'not-just')).toEqual(['не просто навык, а']);
  });
  it('правило можно задать строкой и регулярным выражением', () => {
    const rules: PhraseRule[] = [
      { id: 'a', pattern: 'ёлка', hint: 'x' },
      { id: 'b', pattern: /зелен\p{L}+/u, hint: 'y' },
    ];
    const found = findPatterns(check('Елка зелёная.'), rules).map((f) => f.ruleId);
    expect(found).toEqual(['a', 'b']);
  });
  it('в списке у каждого правила уникальный id и пояснение', () => {
    expect(new Set(PHRASE_RULES.map((r) => r.id)).size).toBe(PHRASE_RULES.length);
    expect(PHRASE_RULES.every((r) => r.hint.length > 10)).toBe(true);
  });
});

describe('длинные тире', () => {
  it('больше одного на три предложения: подсвечиваются все тире', () => {
    const text = 'Дом — это крепость. Сад — это рай. Кот — это друг. Конец.';
    expect(slices(text, 'dashes')).toEqual(['—', '—', '—']);
  });
  it('одно тире на три предложения: нет', () => {
    expect(ids('Дом — это крепость. Сад большой. Кот спит. Конец. Снова. И ещё.')).not.toContain('dashes');
  });
  it('меньше трёх тире: нет', () => {
    expect(ids('Дом — крепость. Сад — рай.')).not.toContain('dashes');
  });
  it('тире в начале абзаца (диалог) не считается', () => {
    expect(ids('— Привет.\n\n— Пока.\n\n— Ещё.\n\n— Да.')).not.toContain('dashes');
  });
});

describe('одинаковая длина соседних предложений', () => {
  const s = (n: number) => `Слово${" слово".repeat(n - 1)}.`;
  it('три подряд с разницей меньше 15%', () => {
    expect(ids(`${s(10)} ${s(10)} ${s(11)}`)).toContain('even-length');
  });
  it('разница 15% и больше: нет', () => {
    expect(ids(`${s(10)} ${s(10)} ${s(12)}`)).not.toContain('even-length');
  });
  it('два предложения мало', () => {
    expect(ids(`${s(10)} ${s(10)}`)).not.toContain('even-length');
  });
  it('короткие предложения не в счёт', () => {
    expect(ids('Да. Нет. Да. Нет.')).not.toContain('even-length');
  });
  it('длинная серия — одно место', () => {
    const f = findPatterns(check(`${s(10)} ${s(10)} ${s(10)} ${s(10)}`)).filter((x) => x.ruleId === 'even-length');
    expect(f).toHaveLength(1);
  });
  it('предложения из разных абзацев не склеиваются', () => {
    expect(ids(`${s(10)} ${s(10)}\n\n${s(10)}`)).not.toContain('even-length');
  });
});

describe('перечисление «во-первых, во-вторых, в-третьих»', () => {
  it('три пункта подряд', () => {
    expect(ids('Во-первых, сон. Во-вторых, еда. В-третьих, спорт.')).toContain('enumeration');
  });
  it('с «в третьих» без дефиса', () => {
    expect(ids('Во-первых, сон. Во-вторых, еда. В третьих, спорт.')).toContain('enumeration');
  });
  it('два пункта: нет', () => {
    expect(ids('Во-первых, сон. Во-вторых, еда.')).not.toContain('enumeration');
  });
  it('пункты в разных абзацах: нет', () => {
    expect(ids('Во-первых, сон.\n\nВо-вторых, еда.\n\nВ-третьих, спорт.')).not.toContain('enumeration');
  });
});
