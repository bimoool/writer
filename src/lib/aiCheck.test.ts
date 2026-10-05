import { describe, expect, it } from 'vitest';
import { findPatterns } from './aiCheck';
import { JUNK_GROUPS, JUNK_RULES, PHRASE_RULES, type PhraseRule } from './aiPatterns';
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

describe('словесный мусор', () => {
  const junk = (text: string) => findPatterns(check(text)).filter((f) => f.category === 'junk');
  const hit = (text: string, id: string) => junk(text).some((f) => f.ruleId === id);

  const positive: Array<[string, string]> = [
    ['junk-in-essence', 'По сути, это обычная задача.'],
    ['junk-no-doubt', 'Безусловно, он прав.'],
    ['junk-as-a-rule', 'Как правило, всё проходит гладко.'],
    ['junk-so-to-say', 'Он, так сказать, герой.'],
    ['junk-carry-out', 'Мы осуществляем контроль.'],
    ['junk-within', 'Работа идёт в рамках проекта.'],
    ['junk-because', 'Мы ушли, в связи с тем, что стемнело.'],
    ['junk-takes-place', 'Такое имеет место.'],
    ['junk-given', 'На данный момент всё тихо.'],
    ['junk-noun-chain', 'Нужно проведение анализа.'],
    ['junk-noun-chain', 'Здесь важно осуществление контроля.'],
  ];
  for (const [id, text] of positive) it(`находит ${id}: «${text}»`, () => expect(hit(text, id)).toBe(true));

  const negative: Array<[string, string]> = [
    ['junk-in-essence', 'Суть дела проста.'],
    ['junk-carry-out', 'Он осуществил мечту? Нет: он сдался.'.replace('осуществил', 'сделал')],
    ['junk-within', 'В рамке висит картина.'],
    ['junk-noun-chain', 'Проведение выходных у моря.'],
    ['junk-given', 'Данные получены сейчас.'],
  ];
  for (const [id, text] of negative) it(`не находит ${id}: «${text}»`, () => expect(hit(text, id)).toBe(false));

  it('слабое правило срабатывает только от minCount совпадений', () => {
    expect(hit('Это действительно так. И это действительно важно.', 'junk-really')).toBe(false);
    expect(hit('Это действительно так. Это действительно важно. Это действительно нужно.', 'junk-really')).toBe(true);
  });
  it('усилители: от трёх', () => {
    expect(hit('Очень хорошо и крайне мило.', 'junk-amplifiers')).toBe(false);
    expect(hit('Очень хорошо, крайне мило и весьма разумно.', 'junk-amplifiers')).toBe(true);
  });
  it('«является» и «данный»: один раз нормально, дважды подсказка', () => {
    expect(hit('Москва является столицей.', 'junk-is')).toBe(false);
    expect(hit('Москва является столицей. Это является фактом.', 'junk-is')).toBe(true);
  });
  it('у каждого правила мусора есть группа и совет', () => {
    for (const r of JUNK_RULES) {
      expect(r.category).toBe('junk');
      expect(r.advice && r.advice.length > 5).toBe(true);
      expect(Object.keys(JUNK_GROUPS)).toContain(r.group);
    }
    expect(new Set([...PHRASE_RULES, ...JUNK_RULES].map((r) => r.id)).size).toBe(PHRASE_RULES.length + JUNK_RULES.length);
  });
  it('штампы и мусор не смешиваются', () => {
    const found = findPatterns(check('Важно отметить, что по сути всё просто.'));
    expect(found.map((f) => [f.ruleId, f.category])).toEqual([['important-note', 'cliche'], ['junk-in-essence', 'junk']]);
  });
});
