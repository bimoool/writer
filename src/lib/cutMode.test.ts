import { describe, expect, it } from 'vitest';
import { cutDocBlock, cutFocusTarget, cutGaps } from './blocks';
import { cutModeReducer, initialCutMode, type CutModeAction, type CutModeState } from './cutMode';
import { createDoc } from './doc';
import { changed, pushUndo, restoreSnapshot, snapshotOf, type Snapshot } from './undo';

const run = (actions: CutModeAction[], from: CutModeState = initialCutMode) => actions.reduce(cutModeReducer, from);

describe('режим разреза: состояние', () => {
  it('включается и выключается явно, первое включение несёт одноразовое пояснение', () => {
    expect(initialCutMode.on).toBe(false);
    expect(run([{ type: 'enable', firstTime: true }])).toMatchObject({ on: true, intro: true });
    expect(run([{ type: 'enable', firstTime: false }])).toMatchObject({ on: true, intro: false });
    expect(run([{ type: 'enable', firstTime: true }, { type: 'exit' }])).toMatchObject({ on: false, intro: false });
  });

  it('разрез не выключает режим и не включает его: он остаётся таким, какой был', () => {
    const on = run([{ type: 'enable', firstTime: false }, { type: 'cut', rightId: 'r1', total: 9 }, { type: 'cut', rightId: 'r2', total: 10 }]);
    expect(on).toMatchObject({ on: true, flashId: 'r2', notice: 10 });
    expect(run([{ type: 'cut', rightId: 'r1', total: 9 }]).on).toBe(false);
  });

  it('сообщение и подсветка гаснут по своим сигналам, не трогая режим', () => {
    const s = run([{ type: 'enable', firstTime: false }, { type: 'cut', rightId: 'r', total: 4 }]);
    expect(run([{ type: 'clearFlash' }], s)).toMatchObject({ on: true, flashId: null, notice: 4 });
    expect(run([{ type: 'clearNotice' }], s)).toMatchObject({ on: true, flashId: 'r', notice: null });
  });

  it('отмена гасит сообщение и подсветку о разрезе, режим остаётся включённым', () => {
    const s = run([{ type: 'enable', firstTime: false }, { type: 'cut', rightId: 'r', total: 4 }, { type: 'undo' }]);
    expect(s).toMatchObject({ on: true, flashId: null, notice: null });
  });
});

describe('режим разреза: сценарий на документе', () => {
  const source = Array.from({ length: 8 }, (_, i) => `Первая мысль ${i + 1} про реку. Вторая мысль ${i + 1} про гору. Третья мысль ${i + 1} про лес.`).join('\n\n');
  let n = 0;
  const newId = () => `id${++n}`;
  const doc0 = createDoc(source, { blockSize: 'short', now: 1, newId });

  /** Один разрез так, как его делает экран: по id блока, первая точка. Возвращает документ, id правой части и состояние. */
  const cutAt = (doc: typeof doc0, state: CutModeState, id: string, gap = 0) => {
    const at = doc.blocks.findIndex((b) => b.id === id);
    const b = doc.blocks[at]!;
    const next = cutDocBlock(doc, at, cutGaps(b.sourceText, 'ru', b.keyphrases)[gap]!.end, newId);
    const rightId = next.blocks[at + 1]!.id;
    return { doc: next, rightId, state: cutModeReducer(state, { type: 'cut', rightId, total: next.blocks.length }) };
  };

  it('разрезы подряд в разных блоках: режим включён, блоков становится больше на число разрезов, правые части находятся по id', () => {
    expect(doc0.blocks).toHaveLength(8);
    let state = cutModeReducer(initialCutMode, { type: 'enable', firstTime: false });
    let doc = doc0;
    const ids = [doc0.blocks[0]!.id, doc0.blocks[2]!.id, doc0.blocks[4]!.id, doc0.blocks[7]!.id];
    const rights: string[] = [];
    for (const id of ids) {
      const r = cutAt(doc, state, id);
      doc = r.doc;
      state = r.state;
      rights.push(r.rightId);
    }
    expect(state).toMatchObject({ on: true, notice: 12, flashId: rights[3] });
    // и ещё раз правую часть первого блока: фокус после такого разреза идёт на её последнюю точку или вправо
    const again = cutAt(doc, state, rights[0]!);
    expect(again.doc.blocks).toHaveLength(13);
    expect(again.state.on).toBe(true);
    // переход к правым частям: после разреза по первой точке фокус идёт на первую точку правой части
    const t = cutFocusTarget(doc, ids[0]!, 'ru');
    expect(t).toEqual({ blockId: rights[0], gap: 'first' });
  });

  it('отмена возвращает разрез, режим остаётся включённым', () => {
    let state = cutModeReducer(initialCutMode, { type: 'enable', firstTime: false });
    let stack: Snapshot[] = [];
    let doc = doc0;
    for (const id of [doc0.blocks[1]!.id, doc0.blocks[3]!.id]) {
      stack = pushUndo(stack, snapshotOf(doc));
      const r = cutAt(doc, state, id);
      expect(changed(doc, r.doc)).toBe(true);
      doc = r.doc;
      state = r.state;
    }
    expect(doc.blocks).toHaveLength(10);
    doc = restoreSnapshot(doc, stack.pop()!);
    state = cutModeReducer(state, { type: 'undo' });
    expect(doc.blocks).toHaveLength(9);
    expect(state).toMatchObject({ on: true, notice: null, flashId: null });
    doc = restoreSnapshot(doc, stack.pop()!);
    expect(doc.blocks.map((b) => b.id)).toEqual(doc0.blocks.map((b) => b.id));
  });
});
