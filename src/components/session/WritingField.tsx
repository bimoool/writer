import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { FIELD_NAMES, textareaProps } from '../../lib/fieldAttrs';
import type { ActivityKind } from '../../lib/pressure';
import { countInput, initialCounter, isPasteInput, resetComposition } from '../../lib/typing';
import { caretBox } from './caret';

export interface FieldCounts {
  typed: number;
  pasted: number;
}

interface Props {
  fieldRef: RefObject<HTMLTextAreaElement>;
  /** Прокручиваемая область, в которой лежит поле: в ней держим каретку на виду. */
  scrollRef: RefObject<HTMLDivElement>;
  value: string;
  /** Пока true (чтение и растворение), ввод заблокирован, но поле остаётся в DOM и принимает фокус. */
  blocked: boolean;
  allowPaste: boolean;
  lang: string;
  mono: boolean;
  label: string;
  onChange: (value: string, counts: FieldCounts) => void;
  onPasteBlocked: () => void;
  /** Любая активность пользователя в поле (для давления, SPEC §7). */
  onActivity?: (kind: ActivityKind) => void;
  /** Композиция IME или предиктивного ввода: текст слова в ней или null, когда её нет. Слово в ней не дописано. */
  onComposition?: (data: string | null) => void;
}

const CARET_PAD_PX = 16;

/**
 * Поле письма. Здесь собрано всё, что зависит от телефона:
 * - блокировка вставки (SPEC §8) на всех путях: событие paste, drop, beforeinput с insertFromPaste
 *   (контекстное «Вставить» на iOS и Android) и ввод во время растворения;
 * - подсчёт набранного и вставленного по inputType без двойного счёта композиции IME;
 * - автовысота и каретка, которая не уходит под экранную клавиатуру.
 */
export function WritingField({ fieldRef, scrollRef, value, blocked, allowPaste, lang, mono, label, onChange, onPasteBlocked, onActivity, onComposition }: Props) {
  const counter = useRef(initialCounter());
  const before = useRef({ length: value.length, selected: 0 });
  const live = useRef({ blocked, allowPaste, onPasteBlocked, onActivity, onComposition });
  const composing = useRef<string | null>(null);

  useEffect(() => {
    live.current = { blocked, allowPaste, onPasteBlocked, onActivity, onComposition };
  });

  const activity = (kind: ActivityKind) => {
    if (!live.current.blocked) live.current.onActivity?.(kind);
  };
  const setComposing = (data: string | null) => {
    if (composing.current === data) return;
    composing.current = data;
    live.current.onComposition?.(data);
  };

  // Активность для давления. keydown на телефоне ненадёжен (Android IME шлёт keyCode 229, диктовка и автозамена
  // keydown не дают вовсе), поэтому слушаем все пути: beforeinput, input, композицию, keydown и перемещение
  // каретки или выделения. Каретку, которую сдвинула программа (стирание слова), за активность не считаем:
  // при ней меняется и текст, а пользователь, двигая каретку, текст не меняет.
  useEffect(() => {
    const ta = fieldRef.current;
    if (!ta) return;
    let seen = { value: ta.value, start: ta.selectionStart, end: ta.selectionEnd };
    const onSelection = () => {
      if (document.activeElement !== ta) return;
      const now = { value: ta.value, start: ta.selectionStart, end: ta.selectionEnd };
      if (now.value === seen.value && (now.start !== seen.start || now.end !== seen.end)) {
        // Каретку переставили без ввода: композиция, даже если браузер не прислал compositionend, кончилась.
        setComposing(null);
        activity('selection');
      }
      seen = now;
    };
    const onKey = () => activity('key');
    // Композиция только активность, не пауза (SPEC §7): остановка посреди слова включает давление как обычно.
    const onCompositionStart = (e: CompositionEvent) => {
      setComposing(e.data ?? '');
      activity('composition');
    };
    const onCompositionUpdate = (e: CompositionEvent) => {
      setComposing(e.data ?? '');
      activity('composition');
    };
    const onCompositionEnd = () => {
      setComposing(null);
      activity('composition');
    };
    // Если композиция оборвалась без compositionend (ушли из поля), её состояние не должно зависнуть.
    const onBlur = () => setComposing(null);
    document.addEventListener('selectionchange', onSelection);
    ta.addEventListener('keydown', onKey);
    ta.addEventListener('compositionstart', onCompositionStart);
    ta.addEventListener('compositionupdate', onCompositionUpdate);
    ta.addEventListener('compositionend', onCompositionEnd);
    ta.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('selectionchange', onSelection);
      ta.removeEventListener('keydown', onKey);
      ta.removeEventListener('compositionstart', onCompositionStart);
      ta.removeEventListener('compositionupdate', onCompositionUpdate);
      ta.removeEventListener('compositionend', onCompositionEnd);
      ta.removeEventListener('blur', onBlur);
      setComposing(null);
    };
  }, [fieldRef]);

  // beforeinput вешаем напрямую: у React onBeforeInput другая природа (textInput) и preventDefault там не гарантирован.
  useEffect(() => {
    const ta = fieldRef.current;
    if (!ta) return;
    const onBefore = (e: InputEvent) => {
      before.current = { length: ta.value.length, selected: ta.selectionEnd - ta.selectionStart };
      if (!live.current.blocked) live.current.onActivity?.('input');
      if (!e.cancelable) return;
      const { blocked: isBlocked, allowPaste: pasteOk, onPasteBlocked: warn } = live.current;
      if (isBlocked) {
        e.preventDefault();
      } else if (!pasteOk && isPasteInput(e.inputType)) {
        e.preventDefault();
        warn();
      }
    };
    ta.addEventListener('beforeinput', onBefore);
    return () => ta.removeEventListener('beforeinput', onBefore);
  }, [fieldRef]);

  const fit = () => {
    const ta = fieldRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight + ta.offsetHeight - ta.clientHeight}px`;
  };

  const ensureCaretVisible = () => {
    const ta = fieldRef.current;
    const scroller = scrollRef.current;
    if (!ta || !scroller || document.activeElement !== ta) return;
    const box = caretBox(ta);
    const fieldTop = ta.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    const top = fieldTop + box.top;
    const bottom = fieldTop + box.bottom;
    if (top - CARET_PAD_PX < scroller.scrollTop) scroller.scrollTop = Math.max(0, top - CARET_PAD_PX);
    else if (bottom + CARET_PAD_PX > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = bottom + CARET_PAD_PX - scroller.clientHeight;
  };

  useLayoutEffect(() => {
    fit();
    ensureCaretVisible();
  });

  useEffect(() => {
    const ta = fieldRef.current;
    if (!ta) return;
    // Каретка должна оставаться видимой при смене ширины (поворот экрана), открытии клавиатуры
    // (visualViewport сжимается) и перемещении курсора. Ждём кадр: контейнер пересчитывает высоту в том же событии.
    const later = () => requestAnimationFrame(() => (fit(), ensureCaretVisible()));
    const ro = new ResizeObserver(later);
    if (ta.parentElement) ro.observe(ta.parentElement);
    document.addEventListener('selectionchange', ensureCaretVisible);
    window.visualViewport?.addEventListener('resize', later);
    ta.addEventListener('focus', later);
    return () => {
      ro.disconnect();
      document.removeEventListener('selectionchange', ensureCaretVisible);
      window.visualViewport?.removeEventListener('resize', later);
      ta.removeEventListener('focus', later);
    };
    // fit и ensureCaretVisible читают только refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <textarea
      ref={fieldRef}
      value={value}
      rows={1}
      lang={lang}
      aria-label={label}
      tabIndex={blocked ? -1 : 0}
      {...textareaProps(FIELD_NAMES.retelling)}
      autoCorrect="on"
      className={`write-field reading-column max-w-none ${mono ? 'font-mono' : ''}`}
      onCompositionStart={() => {
        counter.current = resetComposition();
      }}
      onCompositionEnd={() => {
        counter.current = resetComposition();
      }}
      onChange={(e) => {
        // Пока ввод заблокирован, не трогаем состояние: React вернёт в поле прежнее значение.
        if (blocked) return;
        activity('input');
        const ta = e.currentTarget;
        const ev = e.nativeEvent as InputEvent;
        const inputType = ev.inputType ?? '';
        if (!allowPaste && isPasteInput(inputType)) {
          onPasteBlocked();
          return;
        }
        const inserted = ta.value.length - before.current.length + before.current.selected;
        const result = countInput(counter.current, { inputType, data: ev.data ?? null, inserted });
        counter.current = result.state;
        before.current = { length: ta.value.length, selected: 0 };
        onChange(ta.value, { typed: result.typed, pasted: result.pasted });
      }}
      onPaste={(e) => {
        if (allowPaste && !blocked) return;
        e.preventDefault();
        if (!blocked) onPasteBlocked();
      }}
      onDragOver={(e) => {
        if (!allowPaste || blocked) e.dataTransfer.dropEffect = 'none';
      }}
      onDrop={(e) => {
        if (allowPaste && !blocked) return;
        e.preventDefault();
        if (!blocked) onPasteBlocked();
      }}
    />
  );
}
