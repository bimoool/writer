import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { APPENDIX_A } from '../../lib/__fixtures__/appendix-a';
import { createDoc } from '../../lib/doc';
import { PLATE_EM } from '../../lib/hints';
import { tokenize } from '../../lib/tokens';
import type { Block } from '../../lib/types';
import { HintPanel, PhraseList, Skeleton, ThemeChips } from './HintPanel';

const doc = createDoc(APPENDIX_A);

/** Видимый текст разметки: теги убраны, сущности раскрыты. */
const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
const alnum = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, '');

const phrasesOf = (b: Block) => b.keyphrases.map((p) => b.sourceText.slice(p.start, p.end));
const hiddenTokens = (b: Block) =>
  tokenize(b.sourceText).filter((t) => !b.keyphrases.some((p) => t.start >= p.start && t.end <= p.end));

describe('скелет: в DOM нет слов вне ключевых фраз', () => {
  for (const [i, block] of doc.blocks.entries()) {
    const html = renderToStaticMarkup(<Skeleton text={block.sourceText} phrases={block.keyphrases} mode="skeleton" />);

    it(`блок ${i + 1}: видимый текст состоит только из ключевых фраз и знаков препинания`, () => {
      expect(alnum(textOf(html))).toBe(alnum(phrasesOf(block).join('')));
    });

    it(`блок ${i + 1}: ни одно скрытое слово не встречается в разметке, в том числе в атрибутах`, () => {
      const keyText = phrasesOf(block).join(' ').toLowerCase();
      const lower = html.toLowerCase();
      const hidden = hiddenTokens(block).filter((t) => t.text.length >= 4 && !keyText.includes(t.text.toLowerCase()));
      expect(hidden.length).toBeGreaterThan(5);
      for (const t of hidden) expect(lower, `слово «${t.text}» просочилось в разметку`).not.toContain(t.text.toLowerCase());
    });

    it(`блок ${i + 1}: плашек столько же, сколько скрытых слов, ширина по длине слова`, () => {
      const widths = [...html.matchAll(/class="plate" style="width:([\d.]+)em"/g)].map((m) => Number(m[1]));
      const expected = hiddenTokens(block).map((t) => Array.from(t.text).length * PLATE_EM);
      expect(widths).toHaveLength(expected.length);
      widths.forEach((w, k) => expect(w).toBeCloseTo(expected[k]!, 3));
    });

    it(`блок ${i + 1}: плашки пустые, а сам скелет скрыт от скринридера`, () => {
      expect(html).toMatch(/^<div aria-hidden="true"/);
      expect([...html.matchAll(/<span class="plate"[^>]*><\/span>/g)].length).toBe(hiddenTokens(block).length);
      expect(html).not.toMatch(/aria-label|title=|alt=/);
    });
  }

  it('знаки препинания сохранены', () => {
    const b = doc.blocks[0]!;
    const text = textOf(renderToStaticMarkup(<Skeleton text={b.sourceText} phrases={b.keyphrases} mode="skeleton" />));
    for (const mark of [',', '.']) expect(text).toContain(mark);
  });
});

describe('первые буквы: в DOM только первые буквы скрытых слов', () => {
  for (const [i, block] of doc.blocks.entries()) {
    const html = renderToStaticMarkup(<Skeleton text={block.sourceText} phrases={block.keyphrases} mode="letters" />);

    it(`блок ${i + 1}: фразы целиком плюс первая буква каждого другого слова`, () => {
      const firsts = hiddenTokens(block).map((t) => Array.from(t.text)[0]);
      // порядок в тексте: собираем ожидание по позициям
      const marks = [
        ...block.keyphrases.map((p) => ({ at: p.start, text: block.sourceText.slice(p.start, p.end) })),
        ...hiddenTokens(block).map((t, k) => ({ at: t.start, text: firsts[k]! })),
      ].sort((a, b) => a.at - b.at);
      expect(alnum(textOf(html))).toBe(alnum(marks.map((m) => m.text).join('')));
    });

    it(`блок ${i + 1}: слова длиннее одной буквы целиком в разметку не попадают`, () => {
      const keyText = phrasesOf(block).join(' ').toLowerCase();
      const lower = html.toLowerCase();
      for (const t of hiddenTokens(block).filter((x) => x.text.length >= 4 && !keyText.includes(x.text.toLowerCase()))) {
        expect(lower).not.toContain(t.text.toLowerCase());
      }
    });
  }

  it('плашка в первых буквах короче скелетной на одну букву', () => {
    const b = doc.blocks[0]!;
    const sk = [...renderToStaticMarkup(<Skeleton text={b.sourceText} phrases={b.keyphrases} mode="skeleton" />).matchAll(/width:([\d.]+)em/g)].map((m) => Number(m[1]));
    const letters = [...renderToStaticMarkup(<Skeleton text={b.sourceText} phrases={b.keyphrases} mode="letters" />).matchAll(/width:([\d.]+)em/g)].map((m) => Number(m[1]));
    // однобуквенные слова в первых буквах без плашки, поэтому плашек не больше
    expect(letters.length).toBeLessThan(sk.length);
    expect(Math.max(...letters)).toBeCloseTo(Math.max(...sk) - PLATE_EM, 3);
  });
});

describe('чипсы и панель', () => {
  const b = doc.blocks[1]!;

  it('чипсы: фразы блока в порядке исходника, маркером, списком', () => {
    const html = renderToStaticMarkup(<ThemeChips text={b.sourceText} phrases={b.keyphrases} />);
    expect(html).toMatch(/^<ul aria-label="Темы"/);
    expect([...html.matchAll(/<li class="marker-chip"[^>]*>([^<]*)<\/li>/g)].map((m) => m[1])).toEqual(phrasesOf(b));
  });

  it('без фраз чипсы не рисуются', () => {
    expect(renderToStaticMarkup(<ThemeChips text="Текст" phrases={[]} />)).toBe('');
  });

  it('список фраз для скринридера содержит только фразы', () => {
    const html = renderToStaticMarkup(<PhraseList text={b.sourceText} phrases={b.keyphrases} />);
    expect(html).toContain('class="sr-only"');
    expect([...html.matchAll(/<li>([^<]*)<\/li>/g)].map((m) => m[1])).toEqual(phrasesOf(b));
  });

  const panel = (open: { 1: boolean; 2: boolean; 3: boolean }) =>
    renderToStaticMarkup(<HintPanel text={b.sourceText} phrases={b.keyphrases} lang="ru" open={open} />);

  it('всё закрыто: пусто', () => {
    expect(panel({ 1: false, 2: false, 3: false })).toBe('');
  });

  it('открыт только скелет: скелет скрыт от скринридера, список фраз отдан отдельно', () => {
    const html = panel({ 1: false, 2: true, 3: false });
    expect(html).toContain('data-skeleton="skeleton"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('class="sr-only"');
    expect(html).not.toContain('aria-label="Темы"');
  });

  it('открыты чипсы и скелет: список фраз не дублируется', () => {
    const html = panel({ 1: true, 2: true, 3: false });
    expect(html).toContain('aria-label="Темы"');
    expect(html).not.toContain('class="sr-only"');
  });

  it('открыты скелет и первые буквы: показываются первые буквы', () => {
    const html = panel({ 1: false, 2: true, 3: true });
    expect(html).toContain('data-skeleton="letters"');
    expect(html).not.toContain('data-skeleton="skeleton"');
  });
});
