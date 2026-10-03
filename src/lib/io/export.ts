import type { BlockKind } from '../types';

/** Экспорт (SPEC §10): сборка текста из блоков, .txt и .md, имя файла. .docx собирается в docx.ts. */

export interface ExportBlock {
  paragraphIndex: number;
  kind: BlockKind;
  userText: string;
}

export interface ExportParagraph {
  kind: BlockKind;
  text: string;
}

/**
 * Блоки в абзацы. Блоки с одинаковым paragraphIndex склеиваются через пробел в один абзац с kind первого блока.
 * Блок после ручной склейки хранит paragraphIndex первого, так что вышедший из двух абзацев блок попадает в один.
 * Пробелы по краям обрезаются, пустые блоки пропускаются. pick выбирает, чей текст собирать.
 */
export function exportParagraphs<B extends Omit<ExportBlock, 'userText'>>(
  blocks: B[],
  pick: (block: B) => string,
): ExportParagraph[] {
  const out: Array<ExportParagraph & { paragraphIndex: number }> = [];
  for (const block of blocks) {
    const text = pick(block).trim();
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && last.paragraphIndex === block.paragraphIndex) last.text += ` ${text}`;
    else out.push({ paragraphIndex: block.paragraphIndex, kind: block.kind, text });
  }
  return out.map(({ kind, text }) => ({ kind, text }));
}

/**
 * Строка, которая в Markdown начиналась бы как разметка («# », «- », «1. », «> »), экранируется обратной чертой,
 * чтобы обычный абзац не превратился в заголовок или список.
 */
function escapeMarkdownStart(line: string): string {
  const ordered = /^(\s*\d+)([.)])(?=\s|$)/u;
  if (ordered.test(line)) return line.replace(ordered, '$1\\$2');
  return line.replace(/^(\s*)(#{1,6}|[-*+>])(?=\s|$)/u, '$1\\$2');
}

/**
 * Абзацы в текст. Абзацы разделяются пустой строкой, идущие подряд пункты списка стоят в соседних строках.
 * Пункт списка выводится с маркером «- ». Заголовок в .md выводится как `##`, в .txt остаётся обычной строкой.
 */
export function formatParagraphs(paragraphs: ExportParagraph[], opts: { markdown?: boolean } = {}): string {
  const md = (line: string) => (opts.markdown ? line.split('\n').map(escapeMarkdownStart).join('\n') : line);
  let out = '';
  paragraphs.forEach((p, i) => {
    const line = p.kind === 'heading' && opts.markdown ? `## ${md(p.text)}` : p.kind === 'list-item' ? `- ${md(p.text)}` : md(p.text);
    if (i > 0) out += p.kind === 'list-item' && paragraphs[i - 1]!.kind === 'list-item' ? '\n' : '\n\n';
    out += line;
  });
  return out;
}

/** Текст пользователя для «Скопировать», .txt и .md. */
export const assembleText = (blocks: ExportBlock[], opts: { markdown?: boolean } = {}) =>
  formatParagraphs(
    exportParagraphs(blocks, (b) => b.userText),
    opts,
  );

export interface MarkdownOptions {
  /** «Вместе с исходником»: после текста пользователя идёт исходник цитатой под заголовком sourceHeading. */
  withSource?: boolean;
  sourceHeading?: string;
}

/**
 * .md. По умолчанию только текст пользователя. С исходником: текст пользователя, линия `---`, заголовок
 * `## <sourceHeading>` и исходник целиком цитатой (`> `), чтобы его заголовки и списки не смешались с текстом пользователя.
 */
export function assembleMarkdown(blocks: Array<ExportBlock & { sourceText: string }>, opts: MarkdownOptions = {}): string {
  const own = assembleText(blocks, { markdown: true });
  if (!opts.withSource) return own;
  const source = formatParagraphs(
    exportParagraphs(blocks, (b) => b.sourceText),
    { markdown: true },
  )
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n');
  return [own, '---', `## ${opts.sourceHeading ?? ''}`.trimEnd(), source].filter(Boolean).join('\n\n');
}

/**
 * Транслитерация названия для имени файла (SPEC §10). Упрощённая схема без диакритики, как в загранпаспортах:
 * ж zh, х kh, ц ts, ч ch, ш sh, щ shch, ю yu, я ya, й y, ы y, ё e, э e, ъ и ь пропадают. Украинские і, ї, є, ґ тоже.
 */
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', і: 'i', ї: 'yi', є: 'ye', ґ: 'g',
};

export const transliterate = (text: string) =>
  [...text.toLowerCase()].map((ch) => TRANSLIT[ch] ?? ch).join('');

/**
 * Имя файла только из латиницы, цифр и дефиса: «Тайм-менеджмент и Pomodoro» → «taym-menedzhment-i-pomodoro».
 * Кириллица транслитерируется, буквы с диакритикой теряют её (é → e), всё прочее становится дефисом.
 * Длина до maxLength без хвостового дефиса. Если ничего не осталось, имя «text».
 */
export function slugify(title: string, maxLength = 60): string {
  const slug = transliterate(title)
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return slug || 'text';
}

export const exportFileName = (title: string, ext: string) => `${slugify(title)}.${ext}`;

export type ExportFormat = 'docx' | 'md' | 'txt';

export const EXPORT_MIME: Record<ExportFormat, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  md: 'text/markdown',
  txt: 'text/plain',
};
