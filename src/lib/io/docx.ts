import type { ExportParagraph } from './export';

/** Имя нумерации маркированного списка в документе. */
const BULLETS = 'bullets';

/**
 * .docx из абзацев (SPEC §10): обычный абзац как Normal, заголовок как Heading 2, пункт списка как настоящий
 * маркированный список Word (нумерация с маркером «•»), а не строка с «- ». Переводы строк внутри абзаца
 * становятся разрывами строки. Библиотека docx тяжёлая, поэтому подгружается только здесь, отдельным чанком.
 */
export async function buildDocx(paragraphs: ExportParagraph[], meta: { title?: string; language?: string } = {}): Promise<Blob> {
  const { AlignmentType, Document, HeadingLevel, LevelFormat, Packer, Paragraph, TextRun } = await import('docx');

  const runs = (text: string) => text.split('\n').map((line, i) => new TextRun({ text: line, break: i > 0 ? 1 : undefined }));

  const children = paragraphs.map((p) => {
    if (p.kind === 'heading') return new Paragraph({ heading: HeadingLevel.HEADING_2, children: runs(p.text) });
    if (p.kind === 'list-item') return new Paragraph({ numbering: { reference: BULLETS, level: 0 }, children: runs(p.text) });
    return new Paragraph({ children: runs(p.text) });
  });

  const doc = new Document({
    title: meta.title,
    // Без своих стилей docx даёт абзацы вплотную. Отступ после абзаца 8 pt, межстрочный 1.15, как в Word по умолчанию;
    // пункты списка между собой без отступа (contextualSpacing), перед заголовком воздух.
    styles: {
      default: {
        document: {
          run: { size: 24, language: meta.language ? { value: meta.language } : undefined },
          paragraph: { spacing: { after: 160, line: 276 } },
        },
        heading2: { paragraph: { spacing: { before: 360, after: 120 } } },
      },
      paragraphStyles: [
        {
          id: 'ListParagraph',
          name: 'List Paragraph',
          basedOn: 'Normal',
          quickFormat: true,
          paragraph: { contextualSpacing: true },
        },
      ],
    },
    numbering: {
      config: [
        {
          reference: BULLETS,
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '•',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [{ children }],
  });
  return Packer.toBlob(doc);
}
