import { titleFromFileName } from '../doc';
import { countWords } from '../tokens';

/** Импорт .txt, .md и .docx (SPEC §10). Всё, кроме чтения .docx, чистые функции над байтами. */

export const MAX_CHARS = 200_000;
/** Больше, чем весит любой документ в разумных пределах; защита от зависания на гигабайтном файле. */
export const MAX_DOCX_BYTES = 25 * 1024 * 1024;
export const SUPPORTED_EXTENSIONS = ['txt', 'md', 'docx'] as const;

/** Доля символов замены, начиная с которой UTF-8 считается неверной кодировкой (SPEC §10). */
const REPLACEMENT_SHARE = 0.01;

export type ImportErrorKind =
  /** Формат не поддерживается или файл не читается (битый .docx, бинарник под видом .txt). */
  | 'unreadable'
  /** Файл прочитан, но слов в нём нет. */
  | 'empty'
  | 'tooLong';

export type ImportResult = { ok: true; text: string; title: string } | { ok: false; error: ImportErrorKind };

export type Encoding = 'utf-8' | 'windows-1251' | 'utf-16le' | 'utf-16be';

export function fileExtension(name: string): string {
  const m = /\.([^.\\/]+)$/.exec(name.trim());
  return m ? m[1]!.toLowerCase() : '';
}

export const isSupportedFile = (name: string) => (SUPPORTED_EXTENSIONS as readonly string[]).includes(fileExtension(name));

const countReplacement = (text: string) => text.match(/�/g)?.length ?? 0;

/**
 * Определяет кодировку текстового файла и декодирует его.
 * 1. BOM UTF-16 (так сохраняет «Юникод» блокнот Windows) → UTF-16.
 * 2. Нулевой байт без такого BOM → бинарный файл, null.
 * 3. UTF-8; если символов замены больше 1%, перечитываем как windows-1251.
 */
export function decodeText(bytes: Uint8Array): { text: string; encoding: Encoding } | null {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' };
  if (bytes.includes(0)) return null;

  const utf8 = new TextDecoder('utf-8').decode(bytes); // BOM EF BB BF отбрасывается самим декодером
  if (countReplacement(utf8) / Math.max(1, utf8.length) > REPLACEMENT_SHARE) {
    return { text: new TextDecoder('windows-1251').decode(bytes), encoding: 'windows-1251' };
  }
  return { text: utf8, encoding: 'utf-8' };
}

/** Единый вид текста для разбивки: переводы строк, неразрывные пробелы, невидимые символы. */
export function normalizeImported(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/\u200b|\u200c|\u200d|\u2060|\ufeff/g, '')
    .replace(/\0/g, '');
}

/** Длина в символах Юникода, а не в единицах UTF-16: эмодзи считается одним. Быстрый путь без разбора. */
export function charLength(text: string): number {
  return text.length <= MAX_CHARS ? text.length : [...text].length;
}

/** Проверка уже готового текста: общая для файла и для вставки в поле. */
export function validateText(text: string): ImportErrorKind | null {
  if (charLength(text) > MAX_CHARS) return 'tooLong';
  if (countWords(text) === 0) return 'empty';
  return null;
}

export interface ImportableFile {
  name: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * .docx → текст через mammoth. Библиотека тяжёлая, поэтому подгружается только здесь.
 * Node-сборка mammoth читает `buffer`, браузерная только `arrayBuffer`.
 */
export async function extractDocxText(data: ArrayBuffer): Promise<string> {
  const mammoth = await import('mammoth');
  const input = typeof Buffer !== 'undefined' ? { buffer: Buffer.from(data) } : { arrayBuffer: data };
  return (await mammoth.extractRawText(input)).value;
}

export async function importFile(
  file: ImportableFile,
  extractDocx: (data: ArrayBuffer) => Promise<string> = extractDocxText,
): Promise<ImportResult> {
  const ext = fileExtension(file.name);
  if (!isSupportedFile(file.name)) return { ok: false, error: 'unreadable' };

  // В тексте один символ занимает от 1 до 4 байт, так что больше 4 × лимита байт заведомо слишком много.
  if (ext !== 'docx' && file.size > MAX_CHARS * 4) return { ok: false, error: 'tooLong' };
  if (ext === 'docx' && file.size > MAX_DOCX_BYTES) return { ok: false, error: 'unreadable' };

  let raw: string;
  try {
    const data = await file.arrayBuffer();
    if (ext === 'docx') {
      raw = await extractDocx(data);
    } else {
      const decoded = decodeText(new Uint8Array(data));
      if (!decoded) return { ok: false, error: 'unreadable' };
      raw = decoded.text;
    }
  } catch {
    return { ok: false, error: 'unreadable' };
  }

  const text = normalizeImported(raw).trim();
  const error = validateText(text);
  if (error) return { ok: false, error };
  return { ok: true, text, title: titleFromFileName(file.name) };
}
