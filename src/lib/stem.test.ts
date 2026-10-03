import { describe, expect, it } from 'vitest';
import { RU_ENDING_COUNT, stem } from './stem';

describe('stem', () => {
  it('склеивает падежные формы существительного', () => {
    const forms = ['техника', 'техники', 'технике', 'технику', 'техникой'];
    expect(new Set(forms.map(stem)).size).toBe(1);
  });

  it('склеивает формы прилагательного', () => {
    const forms = ['полезный', 'полезного', 'полезным', 'полезными', 'полезная'];
    expect(new Set(forms.map(stem)).size).toBe(1);
  });

  it('склеивает формы глагола и учитывает возвратность', () => {
    expect(stem('управлять')).toBe(stem('управляет'));
    expect(stem('заключается')).toBe(stem('заключает'));
  });

  it('основа не короче трёх букв', () => {
    expect(stem('она')).toBe('она');
    expect(stem('мир')).toBe('мир');
    expect(stem('миру').length).toBeGreaterThanOrEqual(3);
  });

  it('ё и регистр не влияют на основу', () => {
    expect(stem('Разделённый')).toBe(stem('разделенный'));
  });

  it('английские окончания -s, -es, -ed, -ing, -ly', () => {
    expect(stem('plans')).toBe('plan');
    expect(stem('boxes')).toBe('box');
    expect(stem('worked')).toBe('work');
    expect(stem('working')).toBe('work');
    expect(stem('quickly')).toBe('quick');
    expect(stem('class')).toBe('class');
  });

  it('числа не стеммируются', () => {
    expect(stem('25%')).toBe('25%');
  });

  it('около 60 окончаний', () => {
    expect(RU_ENDING_COUNT).toBeGreaterThanOrEqual(55);
    expect(RU_ENDING_COUNT).toBeLessThanOrEqual(70);
  });
});
