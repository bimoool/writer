import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** Словарь орфографии убран: сервис должен оставаться лёгким (SPEC §15.1). Орфографию проверяет браузер. */

const root = fileURLToPath(new URL('../../', import.meta.url));
const FORBIDDEN = /nspell|dictionary-ru|hunspell|typo-js|spellchecker/i;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe('в проекте нет модулей орфографии', () => {
  it('нет в зависимостях', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<string, Record<string, string>>;
    const names = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
    expect(names.filter((n) => FORBIDDEN.test(n))).toEqual([]);
  });

  it('нет в исходниках', () => {
    const own = walk(join(root, 'src')).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('noDictionary.test.ts'));
    expect(own.filter((f) => /from ['"][^'"]*(nspell|dictionary-)/.test(readFileSync(f, 'utf8')))).toEqual([]);
  });

  it('нет в собранном dist (если он есть) и нет тяжёлых чанков', () => {
    const dist = join(root, 'dist');
    if (!existsSync(dist)) return;
    const js = walk(join(dist, 'assets')).filter((f) => f.endsWith('.js'));
    expect(js.filter((f) => /spell|dictionary/i.test(f))).toEqual([]);
    // Самый тяжёлый чанк сейчас около 0,5 МБ; словарь был 3,5 МБ.
    expect(js.filter((f) => statSync(f).size > 1_000_000)).toEqual([]);
  });
});
