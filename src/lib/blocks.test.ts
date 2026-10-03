import { describe, expect, it } from 'vitest';
import { APPENDIX_A } from './__fixtures__/appendix-a';
import {
  addKeyphrase,
  buildSegments,
  cutDocBlock,
  cutGaps,
  hasProgress,
  mergeBlocks,
  mergeDocBlocks,
  removeKeyphraseAt,
  resegmentDoc,
  setKeyphrases,
  snapToWords,
  splitBlock,
} from './blocks';
import { createDoc, emptyHints } from './doc';
import { phraseTexts } from './keywords';
import type { Block, Doc } from './types';

const seq = () => {
  let n = 0;
  return () => `n${++n}`;
};

const block = (over: Partial<Block> & { sourceText: string }): Block => ({
  id: 'b',
  paragraphIndex: 0,
  kind: 'text',
  keyphrases: [],
  userText: '',
  status: 'pending',
  hints: emptyHints(),
  typedChars: 0,
  pastedChars: 0,
  activeMs: 0,
  ...over,
});

const range = (text: string, needle: string) => ({ start: text.indexOf(needle), end: text.indexOf(needle) + needle.length });

describe('snapToWords: выделение расширяется до границ слов', () => {
  const t = 'Техника Pomodoro помогает работать, а 25% задач и 1980-х годов тоже.';

  it('обрезанные с обеих сторон слова входят целиком', () => {
    expect(snapToWords(t, 3, 12)).toEqual(range(t, 'Техника Pomodoro'));
    expect(snapToWords(t, 12, 20)).toEqual(range(t, 'Pomodoro помогает'));
  });

  it('выделение внутри одного слова даёт это слово', () => {
    expect(snapToWords(t, 11, 14)).toEqual(range(t, 'Pomodoro'));
  });

  it('пробелы по краям отбрасываются', () => {
    const s = t.indexOf(' Pomodoro ');
    expect(snapToWords(t, s, s + ' Pomodoro '.length)).toEqual(range(t, 'Pomodoro'));
  });

  it('знак препинания на краю в фразу не попадает', () => {
    const r = range(t, 'работать,');
    expect(snapToWords(t, r.start, r.end)).toEqual(range(t, 'работать'));
  });

  it('число с процентом и составное слово не режутся', () => {
    expect(snapToWords(t, t.indexOf('25') + 1, t.indexOf('25') + 2)).toEqual(range(t, '25%'));
    expect(snapToWords(t, t.indexOf('1980') + 2, t.indexOf('1980') + 5)).toEqual(range(t, '1980-х'));
  });

  it('выделение, заданное в обратном порядке, и выход за границы текста', () => {
    expect(snapToWords(t, 12, 3)).toEqual(range(t, 'Техника Pomodoro'));
    expect(snapToWords(t, 0, 10_000)?.end).toBe(t.length - 1); // точка в конце не входит
  });

  it('только пробелы и знаки препинания: слов нет', () => {
    expect(snapToWords(t, t.indexOf(', а') , t.indexOf(', а') + 1)).toBeNull();
    expect(snapToWords(t, 7, 8)).toBeNull(); // один пробел
    expect(snapToWords('', 0, 0)).toBeNull();
  });
});

describe('addKeyphrase и removeKeyphraseAt', () => {
  const t = 'Метод придумал Франческо Чирилло в конце 1980-х годов.';
  const fr = range(t, 'Франческо Чирилло');

  it('выделение посередине слова добавляет слово', () => {
    const r = addKeyphrase([fr], t, 2, 4);
    expect(r.ok && phraseTexts(t, r.phrases)).toEqual(['Метод', 'Франческо Чирилло']);
  });

  it('пересечение с существующей фразой запрещено, в том числе частичное и после расширения до слова', () => {
    for (const [s, e] of [
      [fr.start + 3, fr.end - 3], // целиком внутри
      [fr.start - 4, fr.start + 2], // захватывает начало
      [fr.end - 3, fr.end + 4], // захватывает конец и соседнее слово
      [0, t.length], // накрывает всё
    ] as const) {
      expect(addKeyphrase([fr], t, s, e)).toEqual({ ok: false, reason: 'overlap' });
    }
  });

  it('соседнее слово рядом с фразой разрешено', () => {
    const r = addKeyphrase([fr], t, t.indexOf('в конце'), t.indexOf('в конце') + 1);
    expect(r.ok && phraseTexts(t, r.phrases)).toEqual(['Франческо Чирилло', 'в']);
  });

  it('пустое выделение отклоняется', () => {
    expect(addKeyphrase([], t, 5, 5)).toEqual({ ok: false, reason: 'empty' });
  });

  it('removeKeyphraseAt убирает фразу по индексу', () => {
    const phrases = [{ start: 0, end: 5 }, { start: 6, end: 10 }, { start: 11, end: 14 }];
    expect(removeKeyphraseAt(phrases, 1)).toEqual([phrases[0], phrases[2]]);
    expect(removeKeyphraseAt(phrases, 9)).toEqual(phrases);
  });
});

describe('cutGaps: места разреза', () => {
  it('промежуток между предложениями, по одному на границу', () => {
    const doc = createDoc(APPENDIX_A, { newId: seq() });
    const text = doc.blocks[1]!.sourceText; // три предложения
    const gaps = cutGaps(text);
    expect(gaps).toHaveLength(2);
    for (const g of gaps) {
      expect(text.slice(g.start, g.end)).toMatch(/^\s+$/);
      expect(text[g.start - 1]).toBe('.');
    }
  });

  it('сокращения не создают лишних мест разреза', () => {
    expect(cutGaps('Он родился в 1990 г. в Москве и вырос там. Потом уехал, т.е. совсем.')).toHaveLength(1);
  });

  it('один абзац из одного предложения: резать негде', () => {
    expect(cutGaps('Всего одно предложение без продолжения.')).toEqual([]);
  });

  it('промежуток внутри фразы, выделенной руками через границу предложений, не предлагается', () => {
    const t = 'Первое предложение закончилось. Второе началось здесь и идёт дальше.';
    const gap = cutGaps(t)[0]!;
    expect(cutGaps(t, undefined, [{ start: gap.start - 5, end: gap.end + 5 }])).toEqual([]);
  });
});

describe('splitBlock', () => {
  const text = 'Первое предложение про Pomodoro. Второе предложение про Чирилло и перерывы.';
  const gap = cutGaps(text)[0]!;

  it('левая часть сохраняет id, правая получает новый; текст без пробелов по краям', () => {
    const [l, r] = splitBlock(block({ id: 'orig', sourceText: text }), gap.end, seq());
    expect(l.id).toBe('orig');
    expect(r.id).toBe('n1');
    expect(l.sourceText).toBe('Первое предложение про Pomodoro.');
    expect(r.sourceText).toBe('Второе предложение про Чирилло и перерывы.');
  });

  it('фразы остаются со своей частью, правые сдвигаются и указывают на тот же текст', () => {
    const kp = [range(text, 'Pomodoro'), range(text, 'Чирилло'), range(text, 'перерывы')];
    const [l, r] = splitBlock(block({ sourceText: text, keyphrases: kp }), gap.end, seq());
    expect(phraseTexts(l.sourceText, l.keyphrases)).toEqual(['Pomodoro']);
    expect(phraseTexts(r.sourceText, r.keyphrases)).toEqual(['Чирилло', 'перерывы']);
  });

  it('фраза, которую режет точка, удаляется', () => {
    const across = { start: gap.start - 8, end: gap.end + 8 };
    const [l, r] = splitBlock(block({ sourceText: text, keyphrases: [across, range(text, 'перерывы')] }), gap.end, seq());
    expect(l.keyphrases).toEqual([]);
    expect(phraseTexts(r.sourceText, r.keyphrases)).toEqual(['перерывы']);
  });

  it('оба блока в том же абзаце, статус и счётчики сброшены', () => {
    const [l, r] = splitBlock(block({ sourceText: text, paragraphIndex: 4, status: 'done', typedChars: 9, userText: 'x' }), gap.end, seq());
    for (const b of [l, r]) {
      expect(b).toMatchObject({ paragraphIndex: 4, status: 'pending', typedChars: 0, userText: '' });
    }
  });

  it('правая часть заголовка становится обычным текстом, пункт списка остаётся пунктом', () => {
    expect(splitBlock(block({ sourceText: text, kind: 'heading' }), gap.end, seq())[1].kind).toBe('text');
    expect(splitBlock(block({ sourceText: text, kind: 'list-item' }), gap.end, seq())[1].kind).toBe('list-item');
  });

  it('разрез, не оставляющий текста с одной стороны, запрещён', () => {
    expect(() => splitBlock(block({ sourceText: text }), 0, seq())).toThrow();
    expect(() => splitBlock(block({ sourceText: text }), text.length, seq())).toThrow();
  });
});

describe('mergeBlocks', () => {
  const a = block({ id: 'a', paragraphIndex: 1, sourceText: 'Первый блок про Pomodoro.', keyphrases: [{ start: 16, end: 24 }] });
  const b = block({ id: 'b', paragraphIndex: 2, sourceText: 'Второй блок про Чирилло.', keyphrases: [{ start: 16, end: 23 }] });

  it('блоки из разных абзацев склеиваются, paragraphIndex и id берутся от первого', () => {
    const m = mergeBlocks(a, b);
    expect(m.sourceText).toBe('Первый блок про Pomodoro. Второй блок про Чирилло.');
    expect(m.paragraphIndex).toBe(1);
    expect(m.id).toBe('a');
  });

  it('фразы обоих блоков сохраняются и указывают на тот же текст', () => {
    const m = mergeBlocks(a, b);
    expect(phraseTexts(m.sourceText, m.keyphrases)).toEqual(['Pomodoro', 'Чирилло']);
  });

  it('вид блока: одинаковый сохраняется, разный даёт обычный текст', () => {
    expect(mergeBlocks({ ...a, kind: 'list-item' }, { ...b, kind: 'list-item' }).kind).toBe('list-item');
    expect(mergeBlocks({ ...a, kind: 'heading' }, b).kind).toBe('text');
  });

  it('пробел на стыке один, даже если у частей были пробелы по краям', () => {
    expect(mergeBlocks({ ...a, sourceText: 'А. ' }, { ...b, sourceText: ' Б.', keyphrases: [] }).sourceText).toBe('А. Б.');
  });
});

describe('операции над документом', () => {
  const fresh = (): Doc => createDoc(APPENDIX_A, { newId: seq() });

  it('склейка: блоков на один меньше, manualEdits включается, id и paragraphIndex от первого', () => {
    const doc = fresh();
    const merged = mergeDocBlocks(doc, 0);
    expect(merged.blocks).toHaveLength(doc.blocks.length - 1);
    expect(merged.manualEdits).toBe(true);
    expect(merged.blocks[0]).toMatchObject({ id: doc.blocks[0]!.id, paragraphIndex: 0 });
    expect(merged.blocks[0]!.sourceText).toBe(`${doc.blocks[0]!.sourceText} ${doc.blocks[1]!.sourceText}`);
    expect(doc.manualEdits).toBe(false); // исходный документ не изменился
  });

  it('склейка с достаточным числом фраз ничего не добавляет и не убирает: ручной выбор сохраняется', () => {
    const doc = fresh();
    const merged = mergeDocBlocks(doc, 0);
    const before = doc.blocks[0]!.keyphrases.length + doc.blocks[1]!.keyphrases.length;
    expect(merged.blocks[0]!.keyphrases).toHaveLength(before);
    expect(before).toBeGreaterThan(6); // больше шести: автоматически не обрезается
  });

  it('склейка двух блоков без фраз добирает минимум', () => {
    let doc = fresh();
    doc = setKeyphrases(setKeyphrases(doc, 0, []), 1, []);
    const merged = mergeDocBlocks(doc, 0);
    expect(merged.blocks[0]!.keyphrases.length).toBeGreaterThanOrEqual(3);
  });

  it('склейка последнего блока и несуществующего соседа ничего не делает', () => {
    const doc = fresh();
    expect(mergeDocBlocks(doc, doc.blocks.length - 1)).toBe(doc);
  });

  it('разрез: сохранившиеся фразы на месте, у каждой половины не меньше трёх, руками поставленная жива', () => {
    const doc = fresh();
    const text = doc.blocks[0]!.sourceText;
    const manual = range(text, 'Исследования');
    const withManual = setKeyphrases(doc, 0, [...doc.blocks[0]!.keyphrases, manual]);
    const cut = cutDocBlock(withManual, 0, cutGaps(text)[0]!.end, seq());

    expect(cut.blocks).toHaveLength(doc.blocks.length + 1);
    expect(cut.manualEdits).toBe(true);
    const [l, r] = cut.blocks;
    expect(l!.id).toBe(doc.blocks[0]!.id);
    expect(l!.keyphrases.length).toBeGreaterThanOrEqual(3);
    expect(r!.keyphrases.length).toBeGreaterThanOrEqual(3);
    expect(phraseTexts(r!.sourceText, r!.keyphrases)).toContain('Исследования');
    // сохранившиеся автоматические фразы не потеряны
    expect(phraseTexts(l!.sourceText, l!.keyphrases)).toEqual(expect.arrayContaining(['полезным навыком']));
    expect(phraseTexts(r!.sourceText, r!.keyphrases)).toEqual(expect.arrayContaining(['25% больше задач']));
    // добавленные фразы не пересекаются
    for (const b of [l!, r!]) {
      const sorted = [...b.keyphrases].sort((x, y) => x.start - y.start);
      sorted.forEach((p, i) => i && expect(p.start).toBeGreaterThanOrEqual(sorted[i - 1]!.end));
    }
  });

  it('смена размера: пересчёт с нуля, ручные правки теряются, исходник остаётся', () => {
    const edited = mergeDocBlocks(setKeyphrases(fresh(), 1, []), 0);
    expect(edited.manualEdits).toBe(true);
    const redo = resegmentDoc(edited, 'short', seq());
    expect(redo).toMatchObject({ blockSize: 'short', manualEdits: false, currentIndex: 0, source: edited.source });
    expect(redo.blocks.length).toBeGreaterThan(3);
    expect(redo.blocks.every((b) => b.status === 'pending' && b.keyphrases.length > 0)).toBe(true);
  });

  it('hasProgress: любой блок не в pending', () => {
    const doc = fresh();
    expect(hasProgress(doc)).toBe(false);
    doc.blocks[1]!.status = 'writing';
    expect(hasProgress(doc)).toBe(true);
  });
});

describe('buildSegments', () => {
  it('куски подряд покрывают весь текст без дыр и повторов', () => {
    const doc = createDoc(APPENDIX_A, { newId: seq() });
    for (const b of doc.blocks) {
      const segs = buildSegments(b.sourceText, b.keyphrases, cutGaps(b.sourceText, undefined, b.keyphrases));
      expect(segs.map((s) => b.sourceText.slice(s.start, s.end)).join('')).toBe(b.sourceText);
      expect(segs.filter((s) => s.kind === 'phrase')).toHaveLength(b.keyphrases.length);
      segs.forEach((s, i) => i && expect(s.start).toBe(segs[i - 1]!.end));
    }
  });

  it('индекс фразы указывает на её место в массиве фраз', () => {
    const t = 'один два три четыре';
    const segs = buildSegments(t, [range(t, 'три'), range(t, 'один')], []);
    expect(segs.filter((s) => s.kind === 'phrase').map((s) => s.kind === 'phrase' && s.index)).toEqual([1, 0]);
  });

  it('пересекающиеся метки не ломают текст: лишняя пропускается', () => {
    const t = 'один два три';
    const segs = buildSegments(t, [{ start: 0, end: 7 }, { start: 4, end: 11 }], []);
    expect(segs.map((s) => t.slice(s.start, s.end)).join('')).toBe(t);
  });
});

describe('склейка не обрезает фразы', () => {
  it('у блока после ручной склейки может быть больше 6 фраз, все сохраняются', () => {
    const phrase = (i: number) => ({ start: i * 6, end: i * 6 + 5 });
    const mk = (id: string, from: number): Block => ({
      id,
      paragraphIndex: 0,
      kind: 'text',
      sourceText: Array.from({ length: 5 }, (_, i) => `слово${i}`).join(' ') + '.',
      keyphrases: [0, 1, 2, 3].map((i) => phrase(i + from * 0)),
      userText: '',
      status: 'pending',
      hints: emptyHints(),
      typedChars: 0,
      pastedChars: 0,
      activeMs: 0,
    });
    const merged = mergeBlocks(mk('a', 0), mk('b', 0));
    expect(merged.keyphrases.length).toBe(8);
  });
});
