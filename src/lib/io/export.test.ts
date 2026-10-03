import { describe, expect, it } from 'vitest';
import { APPENDIX_A } from '../__fixtures__/appendix-a';
import { createDoc } from '../doc';
import { assembleMarkdown, assembleText, exportFileName, slugify, transliterate, type ExportBlock } from './export';

const b = (paragraphIndex: number, userText: string, kind: ExportBlock['kind'] = 'text'): ExportBlock => ({ paragraphIndex, kind, userText });

describe('assembleText: блоки в текст по SPEC §10', () => {
  it('блоки одного абзаца склеиваются через пробел, абзацы разделяются пустой строкой', () => {
    const text = assembleText([b(0, 'Первое.'), b(0, 'Второе.'), b(1, 'Третье.')]);
    expect(text).toBe('Первое. Второе.\n\nТретье.');
  });

  it('три блока одного абзаца и одиночный блок следом', () => {
    expect(assembleText([b(2, 'а'), b(2, 'б'), b(2, 'в'), b(3, 'г')])).toBe('а б в\n\nг');
  });

  it('склеенный вручную блок (paragraphIndex первого) идёт одним абзацем, следующий абзац отдельно', () => {
    expect(assembleText([b(0, 'Склеенный из двух абзацев.'), b(2, 'Следующий.')])).toBe('Склеенный из двух абзацев.\n\nСледующий.');
  });

  it('пробелы по краям блоков обрезаются, переводы строк внутри пользовательского текста сохраняются', () => {
    expect(assembleText([b(0, '  Строка один\nстрока два  '), b(0, '\n Дальше ')])).toBe('Строка один\nстрока два Дальше');
  });

  it('пустые блоки пропускаются и не дают лишних пустых строк', () => {
    expect(assembleText([b(0, 'А'), b(1, '   '), b(2, 'Б')])).toBe('А\n\nБ');
    expect(assembleText([b(0, '')])).toBe('');
    expect(assembleText([])).toBe('');
  });

  it('заголовок: в .txt обычная строка, в .md с ##', () => {
    const blocks = [b(0, 'Итоги', 'heading'), b(1, 'Текст под заголовком.')];
    expect(assembleText(blocks)).toBe('Итоги\n\nТекст под заголовком.');
    expect(assembleText(blocks, { markdown: true })).toBe('## Итоги\n\nТекст под заголовком.');
  });

  it('пункты списка с маркером, подряд идущие в соседних строках', () => {
    const blocks = [b(0, 'Шаги такие:'), b(1, 'первый', 'list-item'), b(2, 'второй', 'list-item'), b(3, 'Всё.')];
    expect(assembleText(blocks)).toBe('Шаги такие:\n\n- первый\n- второй\n\nВсё.');
  });

  it('пункт списка из двух блоков склеивается в один пункт', () => {
    expect(assembleText([b(1, 'первая часть', 'list-item'), b(1, 'вторая часть', 'list-item')])).toBe('- первая часть вторая часть');
  });

  it('документ из Приложения A: три абзаца из блоков любого размера', () => {
    for (const size of ['short', 'medium', 'long'] as const) {
      const doc = createDoc(APPENDIX_A, { blockSize: size });
      const text = assembleText(doc.blocks.map((block, i) => ({ ...block, userText: `Блок ${i + 1}.` })));
      expect(text.split('\n\n')).toHaveLength(3);
      // все блоки на месте и в порядке
      expect([...text.matchAll(/Блок (\d+)\./g)].map((m) => Number(m[1]))).toEqual(doc.blocks.map((_, i) => i + 1));
    }
    const medium = createDoc(APPENDIX_A, { blockSize: 'medium' });
    expect(assembleText(medium.blocks.map((block, i) => ({ ...block, userText: `Б${i + 1}` })))).toBe('Б1\n\nБ2\n\nБ3');
    const short = createDoc(APPENDIX_A, { blockSize: 'short' });
    expect(assembleText(short.blocks.map((block, i) => ({ ...block, userText: `Б${i + 1}` })))).toBe('Б1 Б2\n\nБ3 Б4\n\nБ5 Б6');
  });
});

describe('assembleMarkdown', () => {
  const src = (paragraphIndex: number, userText: string, sourceText: string, kind: ExportBlock['kind'] = 'text') => ({
    paragraphIndex,
    kind,
    userText,
    sourceText,
  });
  const blocks = [
    src(0, 'Мой заголовок', 'Заголовок', 'heading'),
    src(1, 'Своими словами.', 'Исходный абзац.'),
    src(1, 'Ещё.', 'Второе предложение.'),
    src(2, 'раз', 'один', 'list-item'),
    src(3, 'два', 'два', 'list-item'),
  ];

  it('по умолчанию только текст пользователя', () => {
    expect(assembleMarkdown(blocks)).toBe('## Мой заголовок\n\nСвоими словами. Ещё.\n\n- раз\n- два');
  });

  it('вместе с исходником: линия, заголовок и исходник цитатой с теми же абзацами, заголовками и списками', () => {
    expect(assembleMarkdown(blocks, { withSource: true, sourceHeading: 'Исходник' })).toBe(
      [
        '## Мой заголовок\n\nСвоими словами. Ещё.\n\n- раз\n- два',
        '---',
        '## Исходник',
        '> ## Заголовок\n>\n> Исходный абзац. Второе предложение.\n>\n> - один\n> - два',
      ].join('\n\n'),
    );
  });

  it('исходник попадает целиком, даже если блок пользователя пустой', () => {
    const md = assembleMarkdown([src(0, '', 'Пропущенный блок.'), src(1, 'Есть.', 'Второй.')], { withSource: true, sourceHeading: 'Исходник' });
    expect(md).toContain('> Пропущенный блок.');
    expect(md.startsWith('Есть.')).toBe(true);
  });

  it('обычный абзац, похожий на разметку, экранируется', () => {
    const md = assembleText([b(0, '# не заголовок'), b(1, '- не список'), b(2, '1. не нумерация'), b(3, '> не цитата'), b(4, '#хештег и -5 градусов')], {
      markdown: true,
    });
    expect(md).toBe('\\# не заголовок\n\n\\- не список\n\n1\\. не нумерация\n\n\\> не цитата\n\n#хештег и -5 градусов');
    // в .txt текст как есть
    expect(assembleText([b(0, '# не заголовок')])).toBe('# не заголовок');
  });
});

describe('имя файла', () => {
  it('транслитерация с русского по SPEC §10', () => {
    expect(transliterate('Съешь же ещё этих мягких французских булок, да выпей чаю')).toBe(
      'sesh zhe eshche etikh myagkikh frantsuzskikh bulok, da vypey chayu',
    );
    expect(transliterate('Цапля, хорёк, щука, юла, йод, Ёлка, эхо')).toBe('tsaplya, khorek, shchuka, yula, yod, elka, ekho');
  });

  it('slug: латиница, цифры и дефис, нижний регистр', () => {
    expect(slugify('Тайм-менеджмент и Pomodoro')).toBe('taym-menedzhment-i-pomodoro');
    expect(slugify('  Письмо   инвестору!  ')).toBe('pismo-investoru');
    expect(slugify('Отчёт 2026: итоги / план')).toBe('otchet-2026-itogi-plan');
    expect(slugify('Café déjà vu')).toBe('cafe-deja-vu');
  });

  it('в имени нет ничего, кроме a-z, 0-9 и дефиса', () => {
    for (const t of ['Привет, мир!', 'Ελληνικά и 中文', 'Ünïcödé — тест', 'ъъъ ььь']) expect(slugify(t)).toMatch(/^[a-z0-9-]+$/);
  });

  it('пустое, из одних знаков, эмодзи или неподдержанных алфавитов: запасное имя', () => {
    for (const t of ['', '   ', '...', '😀🎉', '中文', 'ъь']) expect(slugify(t)).toBe('text');
  });

  it('длинное название обрезается без хвостового дефиса', () => {
    const slug = slugify('слово '.repeat(40));
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('exportFileName: slug и расширение', () => {
    expect(exportFileName('Письмо инвестору', 'txt')).toBe('pismo-investoru.txt');
    expect(exportFileName('Тайм-менеджмент и Pomodoro', 'docx')).toBe('taym-menedzhment-i-pomodoro.docx');
  });
});
