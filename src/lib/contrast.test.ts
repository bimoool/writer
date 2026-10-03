import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastRatio, parseHex, parseThemeTokens } from './contrast';

const css = readFileSync(fileURLToPath(new URL('../styles/tokens.css', import.meta.url)), 'utf8');
const themes = parseThemeTokens(css);

describe('contrastRatio', () => {
  it('чёрный к белому = 21', () => {
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 5);
  });
  it('одинаковые цвета = 1', () => {
    expect(contrastRatio('#777777', '#777777')).toBe(1);
  });
  it('не hex — ошибка', () => {
    expect(() => parseHex('red')).toThrow();
  });
});

describe('токены тем (DESIGN §2)', () => {
  it('в tokens.css три темы', () => {
    expect(Object.keys(themes).sort()).toEqual(['dark', 'light', 'sepia']);
  });

  const cases: Array<[string, number]> = [
    ['--text', 4.5],
    ['--text-dim', 4.5],
    ['--text-ghost', 3],
  ];

  for (const theme of ['dark', 'light', 'sepia']) {
    for (const bg of ['--bg', '--surface']) {
      for (const [fg, min] of cases) {
        it(`${theme}: ${fg} к ${bg} не ниже ${min}:1`, () => {
          const t = themes[theme]!;
          expect(contrastRatio(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(min);
        });
      }
    }
  }
});
