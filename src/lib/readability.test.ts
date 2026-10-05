import { describe, expect, it } from 'vitest';
import { buildCheckText } from './checkText';
import { analyzeReadability, countSyllables, fleschOborneva, levelOf } from './readability';

const check = (text: string) => buildCheckText(text.split('\n\n').map((t, i) => ({ id: `b${i}`, paragraphIndex: i, kind: 'text' as const, userText: t })));
const read = (text: string) => analyzeReadability(check(text));

describe('слоги', () => {
  it('считаются по гласным', () => {
    expect(countSyllables('мама')).toBe(2);
    expect(countSyllables('ёлка')).toBe(2);
    expect(countSyllables('продуктивность')).toBe(4);
    expect(countSyllables('взгляд')).toBe(1);
  });
  it('в слове без гласных слогов нет', () => {
    expect(countSyllables('в')).toBe(0);
    expect(countSyllables('встр')).toBe(0);
  });
});

describe('формула Флеша (Оборнева)', () => {
  it('206,835 − 1,3 × слов на предложение − 60,1 × слогов на слово', () => {
    expect(fleschOborneva(10, 2)).toBeCloseTo(206.835 - 13 - 120.2, 6);
  });

  // Эталон 1, посчитан вручную: 1 предложение, 3 слова, 6 слогов (2 на слово): 206,835 − 3,9 − 120,2 = 82,735.
  it('эталон 1: «Мама мыла раму.»', () => {
    const r = read('Мама мыла раму.');
    expect(r.words).toBe(3);
    expect(r.sentences).toBe(1);
    expect(r.score).toBeCloseTo(82.735, 3);
    expect(r.level).toBe('easy');
  });

  // Эталон 2, посчитан вручную: 2 предложения, 8 слов.
  // «Наблюдательность способствует исследовательской продуктивности.» 4 слова: 6 + 7 + 10 + 5 = 28 гласных... см. разбор ниже.
  // наблюдательность: а ю а е ь н о т ь -> а, ю, а, е, о = 5 ... считаем по гласным: н-а-бл-ю-д-а-т-е-л-ь-н-о-с-т-ь: а, ю, а, е, о = 5
  // способствует: о, о, о, у, е, т? с-п-о-с-о-б-с-т-в-у-е-т: о, о, у, е = 4
  // исследовательской: и, с, л, е, д, о, в, а, т, е, л, ь, с, к, о, й: и, е, о, а, е, о = 6
  // продуктивности: п-р-о-д-у-к-т-и-в-н-о-с-т-и: о, у, и, о, и = 5   (итого 20 слогов на 4 слова)
  // «Мы пошли домой.» 3 слова: ы; о, и; о, о = 1 + 2 + 2 = 5
  // Всего 7 слов, 25 слогов, 2 предложения: ASL 3,5, ASW 25/7.
  it('эталон 2: два предложения, 7 слов, 25 слогов', () => {
    const r = read('Наблюдательность способствует исследовательской продуктивности. Мы пошли домой.');
    expect(r.words).toBe(7);
    expect(r.sentences).toBe(2);
    expect(r.syllablesPerWord).toBeCloseTo(25 / 7, 6);
    expect(r.score).toBeCloseTo(206.835 - 1.3 * 3.5 - 60.1 * (25 / 7), 6);
    expect(r.level).toBe('hard');
  });

  it('пустой текст: оценки нет', () => {
    const r = read('');
    expect(r.score).toBeNull();
    expect(r.level).toBeNull();
  });

  it('числа и ссылки в слова не входят', () => {
    expect(read('В 1980 году вышла книга https://example.com/a.').words).toBe(4);
  });

  it('границы оценки словами', () => {
    expect(levelOf(60)).toBe('easy');
    expect(levelOf(59.9)).toBe('medium');
    expect(levelOf(30)).toBe('medium');
    expect(levelOf(29.9)).toBe('hard');
  });
});

describe('длинные предложения и слова', () => {
  const sentence = (n: number) => `Слово${" слово".repeat(n - 1)}.`;
  it('длиннее 25 слов попадает в список, ровно 25 нет', () => {
    const r = read(`${sentence(25)} ${sentence(26)}`);
    expect(r.longSentences.map((s) => s.words)).toEqual([26]);
  });
  it('доля слов длиннее 12 букв', () => {
    // «продуктивностью» 15 букв, «исследовательской» 17, «дом» и «кот» короткие; 13 букв ровно: «интерпретация»
    const r = read('Дом кот продуктивностью исследовательской.');
    expect(r.longWordShare).toBeCloseTo(0.5, 6);
    expect(read('Интерпретация и дом.').longWordShare).toBeCloseTo(1 / 3, 6);
    expect(read('Одиннадцатый дом.').longWordShare).toBe(0); // 12 букв: не длиннее
  });
});

describe('повторы', () => {
  it('три раза за пять предложений: повтор', () => {
    const r = read('Проект начался рано. Проект шёл трудно. Потом всё изменилось. Проект закончили вовремя.');
    expect(r.repeats).toHaveLength(1);
    expect(r.repeats[0]).toMatchObject({ word: 'проект', count: 3 });
  });
  it('две формы одного слова считаются вместе', () => {
    const r = read('Работа сложная. Работы много. Мы любим работу.');
    expect(r.repeats[0]?.count).toBe(3);
  });
  it('два раза не повтор', () => {
    expect(read('Проект начался рано. Проект шёл трудно.').repeats).toEqual([]);
  });
  it('три раза, но дальше пяти предложений: не повтор', () => {
    const r = read('Проект начался. Раз. Два. Три. Четыре. Проект шёл. Пять. Шесть. Семь. Восемь. Проект кончился.');
    expect(r.repeats).toEqual([]);
  });
  it('стоп-слова и предлоги не считаются', () => {
    expect(read('Это важно. Это хорошо. Это правда. Это так.').repeats).toEqual([]);
    expect(read('Он в доме. Она в лесу. Мы в городе. Они в поле.').repeats).toEqual([]);
  });
  it('короткие слова не считаются', () => {
    expect(read('Дом стоит. Дом старый. Дом чужой.').repeats).toEqual([]);
  });
});
