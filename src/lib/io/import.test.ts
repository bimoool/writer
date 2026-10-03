import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MAX_CHARS,
  charLength,
  decodeText,
  fileExtension,
  importFile,
  isSupportedFile,
  normalizeImported,
  validateText,
  type ImportableFile,
} from './import';

const SAMPLE = 'Техника Pomodoro: работать нужно короткими интервалами по 25 минут. Ёлка, «кавычки» и тире — всё на месте.';

/** windows-1251: Node его не кодирует, поэтому таблица для кириллицы и нескольких знаков. */
function encodeCp1251(text: string): Uint8Array {
  const special: Record<string, number> = { 'Ё': 0xa8, 'ё': 0xb8, '—': 0x97, '«': 0xab, '»': 0xbb, '№': 0xb9 };
  return Uint8Array.from([...text].map((ch) => {
    const c = ch.charCodeAt(0);
    if (c < 0x80) return c;
    if (special[ch] !== undefined) return special[ch]!;
    if (c >= 0x410 && c <= 0x44f) return c - 0x410 + 0xc0;
    throw new Error(`Нет в таблице: ${ch}`);
  }));
}

function encodeUtf16(text: string, littleEndian: boolean): Uint8Array {
  const out = [littleEndian ? 0xff : 0xfe, littleEndian ? 0xfe : 0xff];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out.push(...(littleEndian ? [c & 0xff, c >> 8] : [c >> 8, c & 0xff]));
  }
  return Uint8Array.from(out);
}

const utf8 = (s: string) => new TextEncoder().encode(s);

const fileOf = (name: string, bytes: Uint8Array): ImportableFile => ({
  name,
  size: bytes.byteLength,
  arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
});

describe('расширения', () => {
  it('поддерживаются .txt, .md, .docx без учёта регистра', () => {
    for (const n of ['a.txt', 'A.TXT', 'заметки.md', 'Письмо.DOCX', 'my.file.name.txt']) expect(isSupportedFile(n)).toBe(true);
    for (const n of ['a.pdf', 'a.doc', 'a.rtf', 'a', 'txt', 'a.txt.exe', 'a.png', '.gitignore']) expect(isSupportedFile(n)).toBe(false);
    expect(fileExtension('C:\\docs\\a.TXT')).toBe('txt');
  });
});

describe('кодировка (SPEC §10)', () => {
  it('UTF-8 читается как есть', () => {
    expect(decodeText(utf8(SAMPLE))).toEqual({ text: SAMPLE, encoding: 'utf-8' });
  });

  it('UTF-8 с BOM: BOM отбрасывается', () => {
    const bytes = Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8(SAMPLE)]);
    expect(decodeText(bytes)).toEqual({ text: SAMPLE, encoding: 'utf-8' });
  });

  it('windows-1251 определяется по доле символов замены и перечитывается', () => {
    expect(decodeText(encodeCp1251(SAMPLE))).toEqual({ text: SAMPLE, encoding: 'windows-1251' });
  });

  it('короткая запись в windows-1251 тоже определяется', () => {
    expect(decodeText(encodeCp1251('Привет, мир'))).toEqual({ text: 'Привет, мир', encoding: 'windows-1251' });
  });

  it('windows-1251 с большим количеством латиницы и цифр всё равно определяется', () => {
    const text = `${'Pomodoro technique 25 minutes. '.repeat(10)}Это кириллица в конце файла, её достаточно.`;
    expect(decodeText(encodeCp1251(text))?.encoding).toBe('windows-1251');
  });

  it('одиночный символ замены в большом UTF-8 тексте не меняет кодировку (порог 1%)', () => {
    const text = `${'Обычный русский текст. '.repeat(50)}${String.fromCharCode(0xfffd)}`;
    const r = decodeText(utf8(text));
    expect(r?.encoding).toBe('utf-8');
    expect(r?.text).toBe(text);
  });

  it('UTF-16 с BOM (LE и BE) читается', () => {
    expect(decodeText(encodeUtf16(SAMPLE, true))).toEqual({ text: SAMPLE, encoding: 'utf-16le' });
    expect(decodeText(encodeUtf16(SAMPLE, false))).toEqual({ text: SAMPLE, encoding: 'utf-16be' });
  });

  it('бинарный файл с нулевыми байтами не читается', () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
    expect(decodeText(png)).toBeNull();
  });

  it('пустой файл декодируется в пустую строку', () => {
    expect(decodeText(new Uint8Array())).toEqual({ text: '', encoding: 'utf-8' });
  });
});

describe('нормализация и проверка текста', () => {
  it('переводы строк, неразрывные пробелы и невидимые символы', () => {
    const nbsp = String.fromCharCode(0xa0);
    const zw = String.fromCharCode(0x200b, 0xfeff);
    expect(normalizeImported(`a\r\nb\rc${nbsp}d${zw}e`)).toBe('a\nb\nc de');
  });

  it('длина считается в символах, а не в единицах UTF-16', () => {
    expect(charLength('😀'.repeat(MAX_CHARS))).toBe(MAX_CHARS);
    expect(validateText(`слово ${'😀'.repeat(MAX_CHARS - 6)}`)).toBeNull();
  });

  it('лимит 200 000 символов: ровно на границе можно, на один больше нельзя', () => {
    const word = 'а'.repeat(MAX_CHARS);
    expect(validateText(word)).toBeNull();
    expect(validateText(`${word}б`)).toBe('tooLong');
  });

  it('текст без слов считается пустым', () => {
    for (const t of ['', '   \n\n ', '... !!! ???', '😀😀']) expect(validateText(t)).toBe('empty');
  });
});

describe('importFile', () => {
  it('.txt в UTF-8: текст и название из имени файла без расширения', async () => {
    const r = await importFile(fileOf('Письмо инвестору.txt', utf8(SAMPLE)));
    expect(r).toEqual({ ok: true, text: SAMPLE, title: 'Письмо инвестору' });
  });

  it('.md в windows-1251', async () => {
    const r = await importFile(fileOf('заметки.md', encodeCp1251(SAMPLE)));
    expect(r).toMatchObject({ ok: true, text: SAMPLE, title: 'заметки' });
  });

  it('.txt в UTF-16', async () => {
    expect(await importFile(fileOf('a.txt', encodeUtf16(SAMPLE, true)))).toMatchObject({ ok: true, text: SAMPLE });
  });

  it('текст обрезается по краям и нормализуется', async () => {
    const r = await importFile(fileOf('a.txt', utf8('\n\n  Первая строка.\r\nВторая строка.  \n\n')));
    expect(r).toMatchObject({ ok: true, text: 'Первая строка.\nВторая строка.' });
  });

  it('неподдерживаемый формат: unreadable, файл даже не читается', async () => {
    let read = false;
    const f = { name: 'doc.pdf', size: 10, arrayBuffer: async () => ((read = true), new ArrayBuffer(10)) };
    expect(await importFile(f)).toEqual({ ok: false, error: 'unreadable' });
    expect(read).toBe(false);
  });

  it('бинарный файл под видом .txt: unreadable', async () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x0d]);
    expect(await importFile(fileOf('photo.txt', png))).toEqual({ ok: false, error: 'unreadable' });
  });

  it('пустой файл и файл из одних пробелов: empty', async () => {
    expect(await importFile(fileOf('a.txt', new Uint8Array()))).toEqual({ ok: false, error: 'empty' });
    expect(await importFile(fileOf('a.md', utf8(' \n\n\t ')))).toEqual({ ok: false, error: 'empty' });
  });

  it('текст длиннее 200 000 символов: tooLong', async () => {
    expect(await importFile(fileOf('big.txt', utf8(`${'а'.repeat(MAX_CHARS)}б`)))).toEqual({ ok: false, error: 'tooLong' });
  });

  it('огромный файл отсекается по размеру, не читаясь целиком', async () => {
    let read = false;
    const f = { name: 'huge.txt', size: MAX_CHARS * 4 + 1, arrayBuffer: async () => ((read = true), new ArrayBuffer(0)) };
    expect(await importFile(f)).toEqual({ ok: false, error: 'tooLong' });
    expect(read).toBe(false);
  });

  it('ошибка чтения файла: unreadable', async () => {
    const f = { name: 'a.txt', size: 5, arrayBuffer: async () => Promise.reject(new Error('disk')) };
    expect(await importFile(f)).toEqual({ ok: false, error: 'unreadable' });
  });
});

describe('файлы, сохранённые настоящими редакторами (iconv)', () => {
  const read = (name: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url))));
  const expected = new TextDecoder('utf-8').decode(read('utf8.txt'));

  it('cp1251.txt: windows-1251, текст совпадает с UTF-8 версией', () => {
    const r = decodeText(read('cp1251.txt'));
    expect(r?.encoding).toBe('windows-1251');
    expect(r?.text).toBe(expected);
  });

  it('utf16.txt: UTF-16 с BOM', () => {
    const r = decodeText(read('utf16.txt'));
    expect(r?.encoding).toBe('utf-16le');
    expect(r?.text).toBe(expected);
  });

  it('собственный кодировщик из тестов даёт те же байты, что iconv', () => {
    expect(encodeCp1251(expected)).toEqual(read('cp1251.txt'));
  });
});

describe('.docx через настоящий mammoth', () => {
  const docx = new Uint8Array(readFileSync(fileURLToPath(new URL('./__fixtures__/sample.docx', import.meta.url))));

  it('абзацы разделяются пустой строкой, название из имени файла', async () => {
    const r = await importFile(fileOf('Pomodoro.docx', docx));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.title).toBe('Pomodoro');
    expect(r.text.split('\n\n')).toEqual([
      'Техника Pomodoro',
      'Метод придумал Франческо Чирилло в конце 1980-х годов. Работать нужно короткими интервалами по 25 минут.',
      'Между интервалами делают перерывы. Так проще держать концентрацию.',
    ]);
  });

  it('битый .docx: unreadable', async () => {
    expect(await importFile(fileOf('broken.docx', utf8('это не zip-архив')))).toEqual({ ok: false, error: 'unreadable' });
  });

  it('.docx без текста: empty', async () => {
    expect(await importFile(fileOf('empty.docx', docx), async () => '\n\n')).toEqual({ ok: false, error: 'empty' });
  });

  it('.docx слишком длинный: tooLong', async () => {
    expect(await importFile(fileOf('long.docx', docx), async () => 'а'.repeat(MAX_CHARS + 1))).toEqual({ ok: false, error: 'tooLong' });
  });
});
