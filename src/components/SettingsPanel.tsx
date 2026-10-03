import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { ru } from '../i18n/ru';
import { MAX_DELAY_SEC, MIN_DELAY_SEC, clampDelaySec } from '../lib/pressure';
import type { PressureMode } from '../lib/types';
import { useApp } from '../store/app';
import { ThemeSwitcher } from './ThemeSwitcher';

const MODES: { mode: PressureMode; label: string }[] = [
  { mode: 'off', label: ru.settings.pressureOff },
  { mode: 'soft', label: ru.settings.pressureSoft },
  { mode: 'kamikaze', label: ru.settings.pressureKamikaze },
];

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Минимальная панель настроек (фаза 7): тема и давление. Полный набор из SPEC §11 добавится в фазе 9.
 * Модальное окно: фокус внутри, Tab по кругу, Esc и фон закрывают, после закрытия фокус возвращается туда,
 * где был (в сессии это поле письма: на iOS так снова откроется клавиатура, потому что закрытие идёт из жеста).
 */
export function SettingsPanel() {
  const open = useApp((s) => s.settingsOpen);
  if (!open) return null;
  return <Dialog />;
}

function Dialog() {
  const settings = useApp((s) => s.settings);
  const dialog = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const id = useId();

  const close = () => {
    // Синхронно, внутри жеста: возврат фокуса в поле письма снова открывает экранную клавиатуру.
    returnTo.current?.focus({ preventScroll: true });
    useApp.getState().setSettingsOpen(false);
  };

  useEffect(() => {
    // В StrictMode эффект запускается дважды, и во второй раз фокус уже на переключателе: запоминаем только первый.
    if (!returnTo.current) returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.focus({ preventScroll: true });
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== 'Tab' || !dialog.current) return;
    const items = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => !(el instanceof HTMLInputElement && el.type === 'radio' && !el.checked),
    );
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const set = useApp.getState().setSettings;
  const off = settings.pressure === 'off';

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center" onKeyDown={onKeyDown}>
      <div className="absolute inset-0 bg-bg opacity-80" onClick={close} aria-hidden="true" />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        className="relative m-4 max-h-[calc(100dvh-32px)] w-full max-w-[26rem] overflow-y-auto rounded-surface border border-line bg-surface p-4 text-text"
      >
        <h2 id={`${id}-title`} className="text-h2">
          {ru.settings.title}
        </h2>

        <div className="mt-4">
          <p className="text-meta text-text-dim">{ru.theme.label}</p>
          <div className="-ml-2 mt-1">
            <ThemeSwitcher />
          </div>
        </div>

        <fieldset className="mt-4">
          <legend className="text-meta text-text-dim">{ru.settings.pressure}</legend>
          <div className="mt-1 flex flex-col">
            {MODES.map(({ mode, label }) => (
              <div key={mode}>
                <label className="flex min-h-10 cursor-pointer items-center gap-2 text-ui">
                  <input
                    type="radio"
                    name={`${id}-pressure`}
                    value={mode}
                    checked={settings.pressure === mode}
                    onChange={() => set({ pressure: mode })}
                    aria-describedby={mode === 'kamikaze' ? `${id}-kamikaze` : undefined}
                    className="size-4 accent-ink"
                  />
                  {label}
                </label>
                {mode === 'kamikaze' && (
                  <p id={`${id}-kamikaze`} className="mb-1 pl-6 text-meta text-text-dim">
                    {ru.settings.kamikazeNote}
                  </p>
                )}
              </div>
            ))}
          </div>
        </fieldset>

        <div className={`mt-4 ${off ? 'opacity-60' : ''}`}>
          <label htmlFor={`${id}-delay`} className="flex items-baseline justify-between text-meta text-text-dim">
            <span>{ru.settings.delay}</span>
            <output htmlFor={`${id}-delay`} className="tabular-nums text-text">
              {ru.settings.delayValue(settings.pressureDelaySec)}
            </output>
          </label>
          <input
            id={`${id}-delay`}
            type="range"
            min={MIN_DELAY_SEC}
            max={MAX_DELAY_SEC}
            step={1}
            value={settings.pressureDelaySec}
            disabled={off}
            aria-valuetext={ru.settings.delayValue(settings.pressureDelaySec)}
            onChange={(e) => set({ pressureDelaySec: clampDelaySec(Number(e.currentTarget.value)) })}
            className="mt-1 h-10 w-full accent-ink"
          />
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={close}
            className="min-h-10 rounded-surface border border-line px-4 text-ui transition-colors duration-[120ms] hover:border-ink"
          >
            {ru.settings.close}
          </button>
        </div>
      </div>
    </div>
  );
}
