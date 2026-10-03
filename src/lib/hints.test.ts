import { describe, expect, it } from 'vitest';
import { APPENDIX_A } from './__fixtures__/appendix-a';
import { createDoc, emptyHints } from './doc';
import { PEEK_MAX_MS, endPeek, openLevel, skeletonParts, startPeek, type SkeletonPart } from './hints';
import { tokenize } from './tokens';

const doc = createDoc(APPENDIX_A);
const block = doc.blocks[0]!; // 35 слов, четыре ключевые фразы
const phraseText = (b: typeof block) => b.keyphrases.map((p) => b.sourceText.slice(p.start, p.end));

/** Склеивает части обратно в строку: плашка превращается в «·» по числу букв, чтобы сравнивать с оригиналом. */
function render(parts: SkeletonPart[]): string {
  return parts
    .map((p) => (p.kind === 'text' ? p.text : p.kind === 'phrase' ? p.text : p.kind === 'plate' ? '·'.repeat(p.length) : p.letter + '·'.repeat(p.rest)))
    .join('');
}

/** Оригинал, где слова вне ключевых фраз заменены точками (после первой буквы, если first). */
function expected(b: typeof block, first: boolean): string {
  let out = '';
  let pos = 0;
  const inPhrase = (s: number, e: number) => b.keyphrases.some((p) => s >= p.start && e <= p.end);
  const marks = [
    ...b.keyphrases.map((p) => ({ s: p.start, e: p.end, text: b.sourceText.slice(p.start, p.end) })),
    ...tokenize(b.sourceText)
      .filter((t) => !inPhrase(t.start, t.end))
      .map((t) => ({ s: t.start, e: t.end, text: first ? t.text[0]! + '·'.repeat(Array.from(t.text).length - 1) : '·'.repeat(Array.from(t.text).length) })),
  ].sort((a, c) => a.s - c.s);
  for (const m of marks) {
    out += b.sourceText.slice(pos, m.s) + m.text;
    pos = m.e;
  }
  return out + b.sourceText.slice(pos);
}

describe('скелет (ступень 2)', () => {
  const parts = skeletonParts(block.sourceText, block.keyphrases, 'skeleton');

  it('пунктуация и пробелы на месте, слова вне фраз заменены плашками по длине', () => {
    expect(render(parts)).toBe(expected(block, false));
  });

  it('ключевые фразы остаются текстом, в порядке исходника, с индексом', () => {
    const phrases = parts.filter((p): p is Extract<SkeletonPart, { kind: 'phrase' }> => p.kind === 'phrase');
    expect(phrases.map((p) => p.text)).toEqual(phraseText(block));
    expect(phrases.map((p) => p.index)).toEqual(block.keyphrases.map((_, i) => i));
  });

  it('в частях между словами нет ни букв, ни цифр', () => {
    for (const p of parts) if (p.kind === 'text') expect(p.text).not.toMatch(/[\p{L}\p{N}]/u);
  });

  it('слов вне фраз в выдаче нет вовсе: только плашки с длиной', () => {
    const plates = parts.filter((p) => p.kind === 'plate');
    const outside = tokenize(block.sourceText).filter((t) => !block.keyphrases.some((p) => t.start >= p.start && t.end <= p.end));
    expect(plates).toHaveLength(outside.length);
    expect(plates.map((p) => p.kind === 'plate' && p.length)).toEqual(outside.map((t) => Array.from(t.text).length));
    // слова вне ключевых фраз
    const json = JSON.stringify(parts);
    for (const word of ['современном', 'становится', 'просто', 'показывают', 'люди', 'планируют', 'заранее', 'выполняют', 'испытывают', 'значительно', 'стресса']) {
      expect(json).not.toContain(word);
    }
  });

  it('все блоки Приложения A', () => {
    for (const b of doc.blocks) {
      expect(render(skeletonParts(b.sourceText, b.keyphrases, 'skeleton'))).toBe(expected(b, false));
      expect(render(skeletonParts(b.sourceText, b.keyphrases, 'letters'))).toBe(expected(b, true));
    }
  });
});

describe('первые буквы (ступень 3)', () => {
  const parts = skeletonParts(block.sourceText, block.keyphrases, 'letters');

  it('у слова вне фраз видна только первая буква и плашка на остаток', () => {
    expect(render(parts)).toBe(expected(block, true));
    for (const p of parts) if (p.kind === 'letter') expect(Array.from(p.letter)).toHaveLength(1);
  });

  it('ключевые фразы видны целиком, как на скелете', () => {
    expect(parts.filter((p) => p.kind === 'phrase').map((p) => p.kind === 'phrase' && p.text)).toEqual(phraseText(block));
  });

  it('однобуквенное слово: буква без плашки', () => {
    const letters = parts.filter((p) => p.kind === 'letter');
    expect(letters.some((p) => p.kind === 'letter' && p.rest === 0)).toBe(true); // «В», «а»
  });
});

describe('особые случаи', () => {
  it('число, процент и слово с дефисом считаются одним словом', () => {
    const parts = skeletonParts('В 1980-х было 25% роста.', [], 'skeleton');
    expect(parts.filter((p) => p.kind === 'plate').map((p) => p.kind === 'plate' && p.length)).toEqual([1, 6, 4, 3, 5]);
    expect(render(parts)).toBe('·  ······ ···· ··· ·····.'.replace(/ {2}/, ' '));
  });

  it('ёлка и эмодзи: длина в символах, а не в единицах UTF-16', () => {
    const parts = skeletonParts('Ёлка 😀 мир', [], 'skeleton');
    expect(parts.filter((p) => p.kind === 'plate').map((p) => p.kind === 'plate' && p.length)).toEqual([4, 3]);
  });

  it('без ключевых фраз все слова плашки, пустой текст даёт пустой результат', () => {
    expect(skeletonParts('', [], 'skeleton')).toEqual([]);
    expect(skeletonParts('Раз, два.', [], 'skeleton').filter((p) => p.kind === 'phrase')).toEqual([]);
  });

  it('пересекающиеся и выходящие за текст фразы не ломают разбор', () => {
    const t = 'один два три четыре';
    const parts = skeletonParts(t, [{ start: 0, end: 8 }, { start: 4, end: 12 }, { start: 100, end: 120 }, { start: -3, end: 2 }], 'skeleton');
    expect(parts.filter((p) => p.kind === 'phrase')).toHaveLength(1);
    for (const p of parts) if (p.kind === 'text') expect(p.text).not.toMatch(/[\p{L}\p{N}]/u);
  });

  it('смещение фразы посреди слова не выносит слово в разметку целиком', () => {
    const t = 'Техника Pomodoro помогает';
    const parts = skeletonParts(t, [{ start: 3, end: 12 }], 'skeleton'); // «ника Pomo»
    const json = JSON.stringify(parts);
    expect(json).not.toContain('помогает');
    expect(json).not.toContain('Техника');
  });
});

describe('статистика', () => {
  it('открытие ступени: счётчик и максимальная ступень', () => {
    let h = emptyHints();
    h = openLevel(h, 1);
    h = openLevel(h, 1);
    h = openLevel(h, 3);
    expect(h).toEqual({ maxLevel: 3, opens: { 1: 2, 2: 0, 3: 1 }, peeks: 0, peekMs: 0 });
    expect(openLevel(h, 2).maxLevel).toBe(3);
  });

  it('подглядывание: одно удержание = один peek, ступень 4, время суммируется', () => {
    let h = startPeek(emptyHints());
    h = endPeek(h, 1200);
    h = endPeek(startPeek(h), 800);
    expect(h).toMatchObject({ maxLevel: 4, peeks: 2, peekMs: 2000 });
  });

  it('длительность ограничена тремя секундами и не бывает отрицательной', () => {
    expect(endPeek(emptyHints(), 10_000).peekMs).toBe(PEEK_MAX_MS);
    expect(endPeek(emptyHints(), -50).peekMs).toBe(0);
  });

  it('не мутирует исходные подсказки', () => {
    const h = emptyHints();
    openLevel(h, 2);
    startPeek(h);
    endPeek(h, 100);
    expect(h).toEqual(emptyHints());
  });
});
