const COPIED = [
  'box-sizing', 'width', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing', 'line-height',
  'text-transform', 'text-indent', 'word-spacing', 'tab-size',
] as const;

/**
 * Положение каретки внутри textarea (относительно её верхнего края) через зеркальный div:
 * у textarea нет API для координат каретки, а нужно, чтобы курсор не уходил под клавиатуру.
 */
/** Переносит на элемент всё, от чего зависит раскладка текста в textarea. */
export function copyTextLayout(cs: CSSStyleDeclaration, el: HTMLElement): void {
  for (const prop of COPIED) el.style.setProperty(prop, cs.getPropertyValue(prop));
}

function createMirror(cs: CSSStyleDeclaration): HTMLDivElement {
  const mirror = document.createElement('div');
  copyTextLayout(cs, mirror);
  Object.assign(mirror.style, { position: 'absolute', left: '-9999px', top: '0', visibility: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'break-word' });
  return mirror;
}

export function caretBox(ta: HTMLTextAreaElement): { top: number; bottom: number } {
  const cs = getComputedStyle(ta);
  const mirror = createMirror(cs);
  mirror.textContent = ta.value.slice(0, ta.selectionEnd);
  const marker = document.createElement('span');
  marker.textContent = String.fromCharCode(0x200b); // у пустой строки у span нет высоты
  mirror.append(marker);
  document.body.append(mirror);
  const top = marker.offsetTop;
  const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.65;
  mirror.remove();
  return { top, bottom: top + lineHeight };
}

