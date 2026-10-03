import { describe, expect, it } from 'vitest';
import { countWords, detectLang, normalize, tokenize } from './tokens';

const texts = (s: string) => tokenize(s).map((t) => t.text);

describe('tokenize', () => {
  it('склеивает число с суффиксом и процент', () => {
    expect(texts('В конце 1980-х годов на 25% больше')).toEqual(['В', 'конце', '1980-х', 'годов', 'на', '25%', 'больше']);
  });

  it('не режет URL и e-mail внутри и отбрасывает точку в конце', () => {
    expect(texts('Смотри https://example.com/a?b=1, пиши на me@mail.ru.')).toEqual([
      'Смотри',
      'https://example.com/a?b=1',
      'пиши',
      'на',
      'me@mail.ru',
    ]);
  });

  it('пропускает эмодзи, тире и кавычки', () => {
    expect(texts('Ура 😀 — «да»!')).toEqual(['Ура', 'да']);
  });

  it('смещения указывают на исходный текст', () => {
    const s = 'Привет, мир';
    for (const t of tokenize(s)) expect(s.slice(t.start, t.end)).toBe(t.text);
  });

  it('пустая строка даёт ноль слов', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \n ')).toBe(0);
  });
});

describe('detectLang и normalize', () => {
  it('определяет язык по доле кириллицы', () => {
    expect(detectLang('Техника Pomodoro помогает')).toBe('ru');
    expect(detectLang('The Pomodoro technique helps')).toBe('en');
  });

  it('ё → е и нижний регистр', () => {
    expect(normalize('Ёлка ЕЩЁ')).toBe('елка еще');
  });
});
