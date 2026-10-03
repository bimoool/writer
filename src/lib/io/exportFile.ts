import type { Block, Doc } from '../types';
import { buildDocx } from './docx';
import { EXPORT_MIME, assembleMarkdown, assembleText, exportFileName, exportParagraphs, type ExportFormat } from './export';

export interface ExportFileOptions {
  /** «Вместе с исходником», учитывается только для .md (SPEC §9). */
  withSource?: boolean;
  /** Заголовок раздела с исходником в .md. */
  sourceHeading: string;
  /** Язык текста для свойств .docx (проверка орфографии в Word). */
  language?: string;
}

/** Готовый к скачиванию или отправке файл в нужном формате. По умолчанию только текст пользователя. */
export async function makeExportFile(doc: Pick<Doc, 'title'> & { blocks: Block[] }, format: ExportFormat, opts: ExportFileOptions): Promise<File> {
  const name = exportFileName(doc.title, format);
  const type = EXPORT_MIME[format];
  if (format === 'docx') {
    const blob = await buildDocx(
      exportParagraphs(doc.blocks, (b) => b.userText),
      { title: doc.title, language: opts.language },
    );
    return new File([blob], name, { type });
  }
  const text =
    format === 'md'
      ? assembleMarkdown(doc.blocks, { withSource: opts.withSource, sourceHeading: opts.sourceHeading })
      : assembleText(doc.blocks);
  // Перевод строки в конце: так файл выглядит привычно в редакторах и терминале.
  return new File([`${text}\n`], name, { type: `${type};charset=utf-8` });
}
