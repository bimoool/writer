import { describe, expect, it } from 'vitest';
import { ru } from './ru';

describe('причины пустых результатов', () => {
  it('нулевой результат называет объём проверки', () => {
    expect(ru.check.empty.checked(142, 9, 21, ru.check.empty.cliche)).toBe('Проверено 142 слова, 9 предложений, правил 21: шаблонов не найдено');
  });
  it('пороги названы числами', () => {
    expect(ru.check.patterns.rhythmTooShort(6, 2)).toBe('Нужно хотя бы 6 предложений, сейчас 2');
    expect(ru.check.patterns.diversityTooShort(74, 100)).toBe('Нужно хотя бы 100 значимых слов, сейчас 74');
    expect(ru.result.ownWordsTooShort(2)).toBe('Нужно хотя бы 3 слова, сейчас 2');
  });
  it('шаблоны исходника: число с правильным склонением', () => {
    expect(ru.split.templates.found(1)).toBe('В исходнике найдено 1 шаблонное место');
    expect(ru.split.templates.found(3)).toBe('В исходнике найдено 3 шаблонных места');
    expect(ru.split.templates.found(7)).toBe('В исходнике найдено 7 шаблонных мест');
  });
});
