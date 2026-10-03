import { describe, expect, it } from 'vitest';
import { cutDocBlock, mergeDocBlocks, resegmentDoc, setKeyphrases } from './blocks';
import { createDoc } from './doc';
import { MAX_UNDO, changed, pushUndo, restoreSnapshot, snapshotOf, type Snapshot } from './undo';

let n = 0;
const newId = () => `id${n++}`;
const text = 'Первое предложение про время. Второе предложение про планы на день. Третье предложение про отдых и сон ночью.\n\nВторой абзац сюда добавлен, чтобы было что склеивать между собой. Он тоже длинный.';
const make = () => createDoc(text, { blockSize: 'short', now: 1, newId });

describe('отмена правок разбивки', () => {
  it('склейка отменяется: блоки и флаг ручных правок как были', () => {
    const doc = make();
    const snap = snapshotOf(doc);
    const merged = mergeDocBlocks(doc, 0);
    expect(changed(doc, merged)).toBe(true);
    expect(merged.manualEdits).toBe(true);
    expect(restoreSnapshot(merged, snap)).toEqual(doc);
  });

  it('разрез и правка фраз отменяются', () => {
    const doc = make();
    const b = doc.blocks[0]!;
    const phrased = setKeyphrases(doc, 0, [{ start: 0, end: 6 }]);
    expect(restoreSnapshot(phrased, snapshotOf(doc)).blocks[0]!.keyphrases).toEqual(b.keyphrases);
    const gap = b.sourceText.indexOf('. ') + 2;
    const cut = cutDocBlock(doc, 0, gap, newId);
    expect(cut.blocks.length).toBe(doc.blocks.length + 1);
    expect(restoreSnapshot(cut, snapshotOf(doc))).toEqual(doc);
  });

  it('смена размера тоже отменяется, в том числе после ручных правок', () => {
    const edited = mergeDocBlocks(make(), 0);
    const snap = snapshotOf(edited);
    const resized = resegmentDoc(edited, 'long', newId);
    expect(resized.blockSize).toBe('long');
    expect(resized.manualEdits).toBe(false);
    const back = restoreSnapshot(resized, snap);
    expect(back).toEqual(edited);
    expect(back.manualEdits).toBe(true);
    expect(back.blockSize).toBe('short');
  });

  it('восстановление не трогает исходник, название и id документа', () => {
    const doc = make();
    const after = { ...mergeDocBlocks(doc, 0), title: 'другое' };
    const back = restoreSnapshot(after, snapshotOf(doc));
    expect(back.title).toBe('другое');
    expect(back.source).toBe(doc.source);
    expect(back.id).toBe(doc.id);
  });

  it('правка без изменений не считается', () => {
    const doc = make();
    expect(changed(doc, doc)).toBe(false);
    expect(changed(doc, { ...doc, title: 'x' })).toBe(false);
  });

  it('стек ограничен', () => {
    let stack: Snapshot[] = [];
    const snap = snapshotOf(make());
    for (let i = 0; i < MAX_UNDO + 20; i++) stack = pushUndo(stack, snap);
    expect(stack.length).toBe(MAX_UNDO);
  });

  it('push не мутирует прежний стек', () => {
    const stack: Snapshot[] = [];
    pushUndo(stack, snapshotOf(make()));
    expect(stack.length).toBe(0);
  });
});
