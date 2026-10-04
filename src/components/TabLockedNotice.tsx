import { useEffect, useId, useRef } from 'react';
import { ru } from '../i18n/ru';
import { useApp } from '../store/app';

/**
 * Сервис открыли в другой вкладке (store/tabLock.ts). Эта вкладка уже ничего не пишет, поэтому закрываем её
 * целиком: набранное здесь пропало бы. «Работать здесь» перезагружает страницу, и тогда замирает та вкладка.
 */
export function TabLockedNotice() {
  const locked = useApp((s) => s.locked);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (locked) button.current?.focus();
  }, [locked]);

  if (!locked) return null;
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-text`}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-bg px-4"
    >
      <div className="max-w-[26rem]">
        <h2 id={`${id}-title`} className="font-serif text-h2 text-text">
          {ru.tabLocked.title}
        </h2>
        <p id={`${id}-text`} className="mt-2 text-ui text-text-dim">
          {ru.tabLocked.text}
        </p>
        <button
          ref={button}
          type="button"
          onClick={() => window.location.reload()}
          className="mt-6 min-h-12 rounded-surface bg-ink px-6 text-ui font-medium text-bg transition-colors duration-[120ms] hover:bg-ink-hover"
        >
          {ru.tabLocked.here}
        </button>
      </div>
    </div>
  );
}
