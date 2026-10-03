import { useEffect, useRef, useState } from 'react';

/** Выделение внутри текста одного блока, в смещениях sourceText. */
export interface BlockSelection {
  blockId: string;
  start: number;
  end: number;
}

const elementOf = (node: Node): Element | null => (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement);

/**
 * Граница выделения → смещение в sourceText. Каждый кусок текста блока лежит в элементе с data-o
 * (смещение начала) и содержит ровно один текстовый узел.
 */
function boundaryOffset(node: Node, offset: number, root: HTMLElement): number | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const holder = node.parentElement?.closest<HTMLElement>('[data-o]');
    return holder && root.contains(holder) ? Number(holder.dataset.o) + offset : null;
  }
  const el = node as Element;
  const lengthOf = (e: Element) => (e.textContent ?? '').length;
  const child = el.childNodes[offset];
  if (child) {
    const holder = child.nodeType === Node.ELEMENT_NODE ? (child as Element).closest('[data-o]') ?? (child as Element).querySelector('[data-o]') : null;
    return holder instanceof HTMLElement ? Number(holder.dataset.o) : null;
  }
  // Граница после последнего потомка: конец последнего куска текста.
  const last = el.matches('[data-o]') ? el : el.querySelector('[data-o]:last-of-type') ?? [...el.querySelectorAll('[data-o]')].pop();
  return last instanceof HTMLElement ? Number(last.dataset.o) + lengthOf(last) : null;
}

/** Текущее выделение, если оно целиком внутри текста одного блока (и блок не в режиме разреза). */
export function readBlockSelection(): BlockSelection | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const from = elementOf(range.startContainer)?.closest<HTMLElement>('[data-block-text]');
  const to = elementOf(range.endContainer)?.closest<HTMLElement>('[data-block-text]');
  if (!from || from !== to || from.dataset.cutMode === 'true') return null;

  const start = boundaryOffset(range.startContainer, range.startOffset, from);
  const end = boundaryOffset(range.endContainer, range.endOffset, from);
  if (start === null || end === null || end <= start) return null;

  return { blockId: from.dataset.blockId!, start, end };
}

interface Options {
  enabled: boolean;
  /** Мышь: выделение добавляется сразу после отпускания кнопки. */
  onMouseSelect: (sel: BlockSelection) => void;
}

/**
 * Захват выделения текста.
 * - Мышь: добавляем сразу после отпускания кнопки.
 * - Сенсорный экран, перо и клавиатура: пока пользователь двигает границы выделения, ничего не добавляем,
 *   а возвращаем выделение, чтобы показать кнопку «Выделить маркером». Кнопка живёт ещё 0,4 с после
 *   сброса выделения: касание кнопки на некоторых устройствах сначала снимает выделение.
 */
export function useSelectionCapture({ enabled, onMouseSelect }: Options): [BlockSelection | null, () => void] {
  const [pending, setPending] = useState<BlockSelection | null>(null);
  const onMouse = useRef(onMouseSelect);

  useEffect(() => {
    onMouse.current = onMouseSelect;
  });

  useEffect(() => {
    if (!enabled) return;
    let lastInput = 'mouse';
    let hideTimer: ReturnType<typeof setTimeout> | undefined;

    const onDown = (e: PointerEvent) => {
      lastInput = e.pointerType;
    };
    const onKey = () => {
      lastInput = 'key';
    };
    const onChange = () => {
      clearTimeout(hideTimer);
      const sel = readBlockSelection();
      if (sel && lastInput !== 'mouse') setPending(sel);
      else hideTimer = setTimeout(() => setPending(null), 400);
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      // Выделение мышью завершается после mouseup, читаем его в следующем такте.
      setTimeout(() => {
        const sel = readBlockSelection();
        if (sel) onMouse.current(sel);
      }, 0);
    };

    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('selectionchange', onChange);
    document.addEventListener('pointerup', onUp);
    return () => {
      clearTimeout(hideTimer);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('selectionchange', onChange);
      document.removeEventListener('pointerup', onUp);
    };
  }, [enabled]);

  return [pending, () => setPending(null)];
}
