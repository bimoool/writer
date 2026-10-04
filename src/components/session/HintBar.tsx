import type { KeyboardEvent, PointerEvent } from 'react';
import { useRef } from 'react';
import { ru } from '../../i18n/ru';
import type { HintLevel } from '../../lib/hints';
import { keepFocus } from './keepFocus';

interface Props {
  open: Record<HintLevel, boolean>;
  peeking: boolean;
  /** Панель можно спрятать (мышь без движения): на сенсорных экранах стили это игнорируют. */
  hidden: boolean;
  onToggle: (level: HintLevel) => void;
  onPeekStart: () => void;
  onPeekEnd: () => void;
}

const base = 'min-h-10 rounded-surface px-2.5 text-meta transition-colors duration-[120ms]';
const tone = (on: boolean) => (on ? 'bg-surface text-text' : 'text-text-dim hover:text-text');


/**
 * «Подглядеть» работает по удержанию. Начало: pointerdown (мышь, палец, перо) или пробел и Enter на кнопке.
 * Конец: pointerup, pointercancel, потеря захвата, потеря фокуса или отпускание клавиши (плюс 3 секунды в Session).
 * Указатель захватывается кнопкой, поэтому палец, ушедший за её край, подглядывание не обрывает:
 * оно заканчивается только отпусканием (или лимитом 3 с), и случайный сдвиг пальца не отнимает подсказку.
 */
function useHold(onStart: () => void, onEnd: () => void) {
  const held = useRef(false);
  const start = () => {
    if (held.current) return;
    held.current = true;
    onStart();
  };
  const end = () => {
    if (!held.current) return;
    held.current = false;
    onEnd();
  };
  return {
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      start();
    },
    onPointerUp: end,
    onPointerCancel: end,
    onLostPointerCapture: end,
    onBlur: end,
    onMouseDown: keepFocus,
    // Долгое нажатие на телефоне открывает контекстное меню и выделяет текст.
    onContextMenu: keepFocus,
    onDragStart: keepFocus,
    onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => {
      if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
        e.preventDefault();
        start();
      }
    },
    onKeyUp: (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === ' ' || e.key === 'Enter') end();
    },
  };
}

export function HintBar({ open, peeking, hidden, onToggle, onPeekStart, onPeekEnd }: Props) {
  const hold = useHold(onPeekStart, onPeekEnd);
  const toggles: Array<{ level: HintLevel; label: string }> = [
    { level: 1, label: ru.session.hints.topics },
    { level: 2, label: ru.session.hints.skeleton },
    { level: 3, label: ru.session.hints.letters },
  ];
  return (
    <div role="group" aria-label={ru.session.hints.label} data-hidden={hidden} className="hint-bar -mx-1 flex flex-wrap items-center gap-x-0.5">
      {toggles.map(({ level, label }) => (
        <button
          key={level}
          type="button"
          aria-pressed={open[level]}
          aria-keyshortcuts={`Alt+${level}`}
          className={`${base} ${tone(open[level])}`}
          onPointerDown={keepFocus}
          onMouseDown={keepFocus}
          onClick={() => onToggle(level)}
        >
          {label}
        </button>
      ))}
      <button
        type="button"
        aria-pressed={peeking}
        aria-keyshortcuts="Alt+4"
        title={ru.session.hints.hold}
        className={`hold-button ${base} border border-line ${tone(peeking)}`}
        {...hold}
      >
        {ru.session.hints.peek}
        {/* Как пользоваться кнопкой: на десктопе в широком окне «удерживать», на сенсорных экранах всегда «держи»,
            потому что подсказки при наведении там нет. */}
        <span className="hold-note-fine hidden text-text-ghost sm:inline"> {ru.session.hints.hold}</span>
        <span className="hold-note-touch text-text-dim"> {ru.session.hints.holdTouch}</span>
      </button>
    </div>
  );
}
