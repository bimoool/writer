import { describe, expect, it } from 'vitest';
import { APPENDIX_A } from './__fixtures__/appendix-a';
import {
  addKeyphrase,
  buildSegments,
  cutDocBlock,
  cutGaps,
  cutModeTarget,
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

/** Документ из 8 абзацев по три предложения: каждый абзац при коротком размере остаётся блоком. */
const threeSentences = (n: number) =>
  Array.from({ length: n }, (_, i) => `Первая мысль абзаца ${i + 1} про реку. Вторая мысль абзаца ${i + 1} про гору. Третья мысль абзаца ${i + 1} про лес.`).join('\n\n');

describe('последовательные разрезы (регрессия: «режется только один блок», «разрезы не сохраняются»)', () => {
  // у документа и у новых блоков разные префиксы id: иначе совпавшие счётчики дали бы дубли
  const fresh = () => {
    let n = 0;
    return () => `new${++n}`;
  };
  const docOf = () => createDoc(threeSentences(8), { blockSize: 'short', newId: seq() });
  /** Режет блок по id в его первой точке разреза: так же, как обработчик на экране, по актуальному документу. */
  const cutById = (doc: Doc, id: string, gap = 0, newId = fresh()) => {
    const at = doc.blocks.findIndex((b) => b.id === id);
    const b = doc.blocks[at]!;
    return cutDocBlock(doc, at, cutGaps(b.sourceText, 'ru', b.keyphrases)[gap]!.end, newId);
  };
  const joined = (doc: Doc) => doc.blocks.map((b) => b.sourceText).join(' ');

  it('первый, средний и последний блок подряд: +3 блока, все разрезы на месте, текст целый', () => {
    const start = docOf();
    expect(start.blocks.length).toBeGreaterThanOrEqual(8);
    const ids = start.blocks.map((b) => b.id);
    const ids2 = fresh();
    let doc = cutById(start, ids[0]!, 0, ids2);
    doc = cutById(doc, ids[Math.floor(ids.length / 2)]!, 0, ids2);
    doc = cutById(doc, ids[ids.length - 1]!, 0, ids2);
    expect(doc.blocks).toHaveLength(start.blocks.length + 3);
    expect(joined(doc)).toBe(joined(start));
    expect(new Set(doc.blocks.map((b) => b.id)).size).toBe(doc.blocks.length);
    // левые части сохранили id, правые получили новые
    for (const id of [ids[0]!, ids[Math.floor(ids.length / 2)]!, ids[ids.length - 1]!]) expect(doc.blocks.some((b) => b.id === id)).toBe(true);
    expect(doc.blocks.map((b) => b.paragraphIndex)).toEqual([...doc.blocks.map((b) => b.paragraphIndex)].sort((a, b) => a - b));
  });

  it('два разреза подряд в одном блоке: по второй точке, затем по первой левой части', () => {
    const start = docOf();
    const id = start.blocks[2]!.id;
    let doc = cutById(start, id, 1);
    expect(doc.blocks).toHaveLength(start.blocks.length + 1);
    doc = cutById(doc, id, 0);
    expect(doc.blocks).toHaveLength(start.blocks.length + 2);
    expect(joined(doc)).toBe(joined(start));
    expect(doc.blocks.slice(2, 5).map((b) => b.sourceText.split(/(?<=\.)\s/).length)).toEqual([1, 1, 1]);
  });

  it('два разреза подряд в одном блоке: по первой точке, затем по правой части', () => {
    const start = docOf();
    let doc = cutById(start, start.blocks[3]!.id, 0);
    const rightId = doc.blocks[4]!.id;
    expect(rightId).not.toBe(start.blocks[3]!.id);
    doc = cutById(doc, rightId, 0);
    expect(doc.blocks).toHaveLength(start.blocks.length + 2);
    expect(joined(doc)).toBe(joined(start));
    expect(doc.blocks.slice(3, 6).every((b) => cutGaps(b.sourceText, 'ru').length === 0)).toBe(true);
  });

  it('разрез по индексу из устаревшего снимка не нужен: разрез по id после чужого разреза попадает в свой блок', () => {
    const start = docOf();
    const target = start.blocks[5]!;
    // перед ним разрезан более ранний блок: индекс 5 теперь указывает на другой блок
    const after = cutById(start, start.blocks[0]!.id);
    const at = after.blocks.findIndex((b) => b.id === target.id);
    expect(at).toBe(6);
    expect(after.blocks[5]!.sourceText).not.toBe(target.sourceText);
    const doc = cutById(after, target.id);
    expect(doc.blocks[6]!.id).toBe(target.id);
    expect(doc.blocks).toHaveLength(start.blocks.length + 2);
  });

  it('правила: левая часть сохраняет id и paragraphIndex, правая получает новый id, фразы остаются со своей частью', () => {
    const start = docOf();
    const b = start.blocks[1]!;
    const gap = cutGaps(b.sourceText, 'ru', b.keyphrases)[0]!;
    const doc = cutById(start, b.id);
    const [l, r] = [doc.blocks[1]!, doc.blocks[2]!];
    expect([l.id, l.paragraphIndex, r.paragraphIndex]).toEqual([b.id, b.paragraphIndex, b.paragraphIndex]);
    expect(r.id).not.toBe(b.id);
    for (const p of start.blocks[1]!.keyphrases) {
      const text = b.sourceText.slice(p.start, p.end);
      if (p.end <= gap.start) expect(phraseTexts(l.sourceText, l.keyphrases)).toContain(text);
      else if (p.start >= gap.end) expect(phraseTexts(r.sourceText, r.keyphrases)).toContain(text);
    }
    expect(l.keyphrases.length).toBeGreaterThanOrEqual(3);
    expect(r.keyphrases.length).toBeGreaterThanOrEqual(3);
  });

  it('cutModeTarget: режим остаётся в том же блоке, пока в нём есть точки, затем переходит к правой части, затем закрывается', () => {
    const start = docOf();
    const id = start.blocks[0]!.id;
    const first = cutById(start, id, 1); // слева два предложения: точка ещё есть
    expect(cutModeTarget(first, id, 'ru')).toBe(id);
    const second = cutById(first, id, 0); // слева одно предложение, справа тоже одно
    expect(cutModeTarget(second, id, 'ru')).toBeNull();
    const viaLeft = cutById(start, id, 0); // слева одно предложение, справа два
    expect(cutModeTarget(viaLeft, id, 'ru')).toBe(viaLeft.blocks[1]!.id);
    expect(cutModeTarget(viaLeft, 'нет-такого', 'ru')).toBeNull();
  });

  it('заголовок после разреза: левая часть остаётся заголовком, правая становится обычным текстом', () => {
    const heading = block({ id: 'h', kind: 'heading', paragraphIndex: 3, sourceText: 'Как устроена река. И почему она меняется.' });
    const [l, r] = splitBlock(heading, cutGaps(heading.sourceText, 'ru')[0]!.end, seq());
    expect([l.id, l.kind, l.paragraphIndex]).toEqual(['h', 'heading', 3]);
    expect([r.kind, r.paragraphIndex]).toEqual(['text', 3]);
  });
});
