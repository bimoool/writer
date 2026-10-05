import nspell from 'nspell';
import { beforeAll, describe, expect, it } from 'vitest';
import { isWordOk, misspelled, spellCandidates } from './spell';

describe('какие слова проверяются', () => {
  const words = (t: string) => spellCandidates(t).map((c) => c.word);
  it('числа, ссылки, латиница, аббревиатуры, одиночные буквы пропускаются', () => {
    expect(words('В 1980-х вышел iPhone по адресу https://ru.example.com/a, писать на me@mail.ru. ЧПУ и РФ — а я.')).toEqual(['вышел', 'по', 'адресу', 'писать', 'на']);
  });
  it('слово с заглавной посреди предложения считается именем', () => {
    expect(words('Мы видели Чирилло. Чирилло ушёл.')).toEqual(['Мы', 'видели', 'Чирилло', 'ушёл']);
  });
  it('смещения указывают на слово', () => {
    const t = 'раз, «два» три';
    for (const c of spellCandidates(t)) expect(t.slice(c.start, c.end)).toBe(c.word);
  });
});

describe('ё и е', () => {
  const dict = new Set(['ещё', 'всё', 'ёж']);
  const ok = (w: string) => dict.has(w);
  it('«еще» верно с поправкой на ё', () => expect(isWordOk('еще', ok)).toBe(true));
  it('«еж» верно с поправкой на ё', () => expect(isWordOk('еж', ok)).toBe(true));
  it('«ёж» с ё в тексте и без неё в словаре', () => expect(isWordOk('ёж', (w) => w === 'еж')).toBe(true));
  it('неизвестное слово остаётся ошибкой', () => expect(isWordOk('ещо', ok)).toBe(false));
});

describe('словарь ru (nspell)', () => {
  let correct: (w: string) => boolean;
  let suggest: (w: string) => string[];
  beforeAll(async () => {
    const { default: dictionary } = await import('dictionary-ru');
    const spell = nspell(Buffer.from(dictionary.aff), Buffer.from(dictionary.dic));
    correct = (w) => spell.correct(w);
    suggest = (w) => spell.suggest(w);
  }, 60_000);

  it('находит слова с ошибкой', () => {
    const text = 'Мы пошли в магазн и купили хлеп и молоко, потом превет сказали сосдям.';
    const bad = misspelled(spellCandidates(text).map((c) => c.word), correct);
    expect(bad).toEqual(['магазн', 'хлеп', 'превет', 'сосдям']);
  }, 60_000);

  it('не трогает правильные слова, формы и «еще»', () => {
    const text = 'Продуктивностью управляют концентрацию. Он еще не вернулся, всё хорошо, кто-нибудь придёт во-первых.';
    expect(misspelled(spellCandidates(text).map((c) => c.word), correct)).toEqual([]);
  }, 60_000);

  it('предлагает исправление', () => {
    expect(suggest('магазн')).toContain('магазин');
  }, 60_000);
});
