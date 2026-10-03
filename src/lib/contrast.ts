/** Контраст по WCAG 2.x для цветов в формате #rgb / #rrggbb. */

export function parseHex(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`Не hex-цвет: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Достаёт переменные каждой темы из tokens.css: { dark: { '--bg': '#171a21', ... }, ... }. */
export function parseThemeTokens(css: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  const blockRe = /([^{}]+)\{([^}]*)\}/g;
  for (const m of css.matchAll(blockRe)) {
    const selector = m[1] ?? '';
    const body = m[2] ?? '';
    const themes = [...selector.matchAll(/data-theme='(\w+)'/g)].map((t) => t[1]!);
    for (const theme of themes) {
      const vars = (out[theme] ??= {});
      for (const v of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[v[1]!] = v[2]!.trim();
    }
  }
  return out;
}
