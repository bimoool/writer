import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { blend, contrastRatio, parseHex, parseThemeTokens } from './contrast';

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

describe('токены тем: акценты и маркер (WCAG AA)', () => {
  for (const theme of ['dark', 'light', 'sepia']) {
    const t = () => themes[theme]!;
    it(`${theme}: --ink (фокус, границы, ползунок) к --bg и --surface не ниже 3:1`, () => {
      expect(contrastRatio(t()['--ink']!, t()['--bg']!)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(t()['--ink']!, t()['--surface']!)).toBeGreaterThanOrEqual(3);
    });
    it(`${theme}: текст кнопки (--bg) на --ink не ниже 4.5:1`, () => {
      expect(contrastRatio(t()['--bg']!, t()['--ink']!)).toBeGreaterThanOrEqual(4.5);
    });
    it(`${theme}: --danger (сообщения об ошибках) к --bg и --surface не ниже 4.5:1`, () => {
      expect(contrastRatio(t()['--danger']!, t()['--bg']!)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t()['--danger']!, t()['--surface']!)).toBeGreaterThanOrEqual(4.5);
    });
    for (const [name, token, alpha] of [['переноса из исходника', '--danger', 0.26], ['шаблонов', '--ink', 0.24]] as const) {
      it(`${theme}: --text поверх подсветки ${name} не ниже 4.5:1`, () => {
        for (const bg of ['--bg', '--surface']) {
          expect(contrastRatio(t()['--text']!, blend(t()[token]!, t()[bg]!, alpha))).toBeGreaterThanOrEqual(4.5);
        }
      });
    }
    it(`${theme}: --text поверх маркера не ниже 4.5:1`, () => {
      const tint = blend(t()['--marker']!, t()['--bg']!, Number(t()['--marker-alpha']));
      expect(contrastRatio(t()['--text']!, tint)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
