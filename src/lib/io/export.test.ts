import { describe, expect, it } from 'vitest';
import { APPENDIX_A } from '../__fixtures__/appendix-a';
import { createDoc } from '../doc';
import { assembleText, exportFileName, slugify, type ExportBlock } from './export';

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

describe('имя файла', () => {
  it('slug: нижний регистр, буквы и цифры остаются, остальное дефис', () => {
    expect(slugify('Тайм-менеджмент и Pomodoro')).toBe('тайм-менеджмент-и-pomodoro');
    expect(slugify('  Письмо   инвестору!  ')).toBe('письмо-инвестору');
    expect(slugify('Отчёт 2026: итоги / план')).toBe('отчёт-2026-итоги-план');
  });

  it('пустое, из одних знаков и эмодзи: запасное имя', () => {
    for (const t of ['', '   ', '...', '😀🎉']) expect(slugify(t)).toBe('text');
  });

  it('длинное название обрезается без хвостового дефиса', () => {
    const slug = slugify('слово '.repeat(40));
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('exportFileName: slug и расширение', () => {
    expect(exportFileName('Письмо инвестору', 'txt')).toBe('письмо-инвестору.txt');
  });
});
