import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FIELD_NAMES, NO_AUTOFILL, inputProps, textareaProps } from './fieldAttrs';

describe('атрибуты текстовых полей', () => {
  it('набор против автозаполнения', () => {
    expect(NO_AUTOFILL).toEqual({
      autoComplete: 'off',
      autoCapitalize: 'sentences',
      spellCheck: true,
      'data-lpignore': 'true',
      'data-1p-ignore': 'true',
      'data-bwignore': 'true',
      'data-form-type': 'other',
    });
  });

  it('проверка орфографии остаётся включённой', () => {
    expect(textareaProps(FIELD_NAMES.retelling).spellCheck).toBe(true);
    expect(inputProps(FIELD_NAMES.title).spellCheck).toBe(true);
  });

  it('textarea: inputMode text и Enter ставит перевод строки', () => {
    const p = textareaProps(FIELD_NAMES.retelling);
    expect(p).toMatchObject({ name: 'retelling-text', inputMode: 'text', enterKeyHint: 'enter', autoComplete: 'off' });
    expect('type' in p).toBe(false);
  });

  it('однострочное поле: Enter на клавиатуре подписан «готово»', () => {
    expect(inputProps(FIELD_NAMES.title)).toMatchObject({ name: 'doc-title', type: 'text', inputMode: 'text', enterKeyHint: 'done' });
  });

  it('имена нейтральные: ни одна часть имени не из тех, по которым браузер угадывает автозаполнение', () => {
    const forbidden = new Set(['name', 'email', 'mail', 'address', 'addr', 'user', 'username', 'login', 'pass', 'password', 'pwd', 'card', 'search', 'phone', 'tel', 'zip', 'city', 'street']);
    for (const value of Object.values(FIELD_NAMES)) {
      for (const part of value.split('-')) expect(forbidden.has(part)).toBe(false);
    }
    expect(Object.values(FIELD_NAMES)).toEqual(['retelling-text', 'source-text', 'doc-title']);
  });

  it('у каждого поля своё имя', () => {
    expect(new Set(Object.values(FIELD_NAMES)).size).toBe(Object.keys(FIELD_NAMES).length);
  });
});

/** Защита от нового поля без общего набора: считаем поля в исходниках и места, где подключён хелпер. */
describe('все текстовые поля используют общий хелпер', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith('.tsx')) files.push(full);
    }
  };
  walk(root);

  it('в проекте есть компоненты с полями', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const textareas = (src.match(/<textarea\b/g) ?? []).length;
    const inputs = (src.match(/<input\b/g) ?? []).length;
    // Не текстовые поля (файл, ползунок, переключатели) автозаполнению не подвержены.
    const fileInputs = (src.match(/type="(file|range|radio|checkbox)"/g) ?? []).length;
    if (textareas + inputs === 0) continue;
    it(`${file.slice(root.length)}`, () => {
      const helpers = (src.match(/\b(textareaProps|inputProps)\(/g) ?? []).length;
      expect(helpers).toBeGreaterThanOrEqual(textareas + inputs - fileInputs);
      expect(src).not.toMatch(/<form\b/);
    });
  }
});
