import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import type { Block } from '../types';
import { buildDocx } from './docx';
import { exportParagraphs } from './export';

async function documentXml(blob: Blob): Promise<string> {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  return zip.file('word/document.xml')!.async('string');
}

/** Абзацы document.xml: стиль, есть ли нумерация и текст. */
function paragraphsOf(xml: string) {
  return [...xml.matchAll(/<w:p>([\s\S]*?)<\/w:p>|<w:p [^>]*>([\s\S]*?)<\/w:p>/g)].map((m) => {
    const body = m[1] ?? m[2] ?? '';
    return {
      style: /<w:pStyle w:val="([^"]+)"/.exec(body)?.[1] ?? null,
      list: body.includes('<w:numPr>'),
      text: [...body.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(''),
      breaks: (body.match(/<w:br\/>/g) ?? []).length,
    };
  });
}

describe('buildDocx (SPEC §10)', () => {
  it('абзацы, заголовок как Heading 2 и пункты списка как маркированный список', async () => {
    const paragraphs = exportParagraphs(
      [
        { paragraphIndex: 0, kind: 'heading' as const, userText: 'Итоги недели' },
        { paragraphIndex: 1, kind: 'text' as const, userText: 'Первое предложение.' },
        { paragraphIndex: 1, kind: 'text' as const, userText: 'Второе & «третье».' },
        { paragraphIndex: 2, kind: 'list-item' as const, userText: 'пункт один' },
        { paragraphIndex: 3, kind: 'list-item' as const, userText: 'пункт два' },
        { paragraphIndex: 4, kind: 'text' as const, userText: 'Строка\nвторая строка' },
      ],
      (b) => b.userText,
    );
    const blob = await buildDocx(paragraphs, { title: 'Итоги', language: 'ru-RU' });
    const ps = paragraphsOf(await documentXml(blob));
    expect(ps.map(({ style, list, text }) => ({ style, list, text }))).toEqual([
      { style: 'Heading2', list: false, text: 'Итоги недели' },
      { style: null, list: false, text: 'Первое предложение. Второе &amp; «третье».' },
      { style: 'ListParagraph', list: true, text: 'пункт один' },
      { style: 'ListParagraph', list: true, text: 'пункт два' },
      { style: null, list: false, text: 'Строкавторая строка' },
    ]);
    expect(ps[4]!.breaks).toBe(1);
  });

  it('пустой документ собирается без ошибок', async () => {
    const blob = await buildDocx([]);
    expect(blob.size).toBeGreaterThan(0);
  });
});

describe('makeExportFile', async () => {
  const { makeExportFile } = await import('./exportFile');
  const block = (paragraphIndex: number, kind: Block['kind'], userText: string, sourceText: string): Block => ({
    id: String(paragraphIndex),
    paragraphIndex,
    kind,
    userText,
    sourceText,
    keyphrases: [],
    status: 'done',
    hints: { maxLevel: 0, opens: { 1: 0, 2: 0, 3: 0 }, peeks: 0, peekMs: 0 },
    typedChars: 0,
    pastedChars: 0,
    activeMs: 0,
  });
  const doc = { title: 'Письмо инвестору', blocks: [block(0, 'heading', 'Привет', 'Здравствуйте'), block(1, 'text', 'Коротко о деле.', 'Пишу по делу.')] };

  it('имя латиницей, тип и текст по формату; исходник только в .md и только по опции', async () => {
    const txt = await makeExportFile(doc, 'txt', { sourceHeading: 'Исходник', withSource: true });
    expect(txt.name).toBe('pismo-investoru.txt');
    expect(txt.type).toBe('text/plain;charset=utf-8');
    expect(await txt.text()).toBe('Привет\n\nКоротко о деле.\n');

    const md = await makeExportFile(doc, 'md', { sourceHeading: 'Исходник' });
    expect(await md.text()).toBe('## Привет\n\nКоротко о деле.\n');
    const mdSrc = await makeExportFile(doc, 'md', { sourceHeading: 'Исходник', withSource: true });
    expect(await mdSrc.text()).toBe('## Привет\n\nКоротко о деле.\n\n---\n\n## Исходник\n\n> ## Здравствуйте\n>\n> Пишу по делу.\n');

    const docx = await makeExportFile(doc, 'docx', { sourceHeading: 'Исходник', withSource: true });
    expect(docx.name).toBe('pismo-investoru.docx');
    const xml = await documentXml(docx);
    expect(xml).toContain('Коротко о деле.');
    expect(xml).not.toContain('Пишу по делу.');
  });
});
