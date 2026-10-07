import { useEffect, useId, useRef, type ReactNode } from 'react';
import { ru } from '../i18n/ru';
import { MAX_DELAY_SEC, MIN_DELAY_SEC, clampDelaySec } from '../lib/pressure';
import type { BlockSize, PressureMode, Settings } from '../lib/types';
import { THEMES, useApp } from '../store/app';
import { Segmented } from './Segmented';

const SIZES: { value: BlockSize; label: string }[] = [
  { value: 'short', label: ru.split.sizes.short },
  { value: 'medium', label: ru.split.sizes.medium },
  { value: 'long', label: ru.split.sizes.long },
];

const FONTS: { value: Settings['writingFont']; label: string }[] = [
  { value: 'serif', label: ru.settings.fontSerif },
  { value: 'mono', label: ru.settings.fontMono },
];

const MODES: { mode: PressureMode; label: string; note: string }[] = [
  { mode: 'off', label: ru.settings.pressureOff, note: ru.settings.pressureOffNote },
  { mode: 'soft', label: ru.settings.pressureSoft, note: ru.settings.pressureSoftNote },
  { mode: 'kamikaze', label: ru.settings.pressureKamikaze, note: ru.settings.kamikazeNote },
];

const navButton =
  'min-h-10 rounded-surface border border-line px-3 text-ui text-text transition-colors duration-[120ms] hover:border-ink disabled:opacity-50';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Панель настроек (SPEC §11). Модальное окно: фокус внутри, Tab по кругу, Esc и фон закрывают, после закрытия
 * фокус возвращается туда, где был (в сессии это поле письма: на iOS так снова откроется клавиатура,
 * потому что закрытие идёт из жеста).
 *
 * Всё, что блокирует, давит или стирает, собрано в одном блоке «Строгие режимы», у каждого пункта есть
 * строка пояснения. Давление выключено, пока его не включат; блокировка вставки включена, пока её не выключат.
 */
export function SettingsPanel() {
  const open = useApp((s) => s.settingsOpen);
  if (!open) return null;
  return <Dialog />;
}

function Choice({ name, checked, onChange, label, note, noteId }: { name: string; checked: boolean; onChange: () => void; label: string; note?: string; noteId?: string }) {
  return (
    <div>
      <label className="flex min-h-10 cursor-pointer items-center gap-2 text-ui">
        <input type="radio" name={name} checked={checked} onChange={onChange} aria-describedby={note ? noteId : undefined} className="size-4 accent-ink" />
        {label}
      </label>
      {note && (
        <p id={noteId} className="mb-1 pl-6 text-meta text-text-dim">
          {note}
        </p>
      )}
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="mt-4 min-w-0">
      <legend className="text-meta text-text-dim">{title}</legend>
      <div className="mt-1 flex flex-col">{children}</div>
    </fieldset>
  );
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
    // В StrictMode эффект запускается дважды, и во второй раз фокус уже внутри окна: запоминаем только первый.
    if (!returnTo.current) returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.focus({ preventScroll: true });
  }, []);

  // Клавиши слушает окно, а не только сама панель: если фокус потерялся (нажали на пустое место), Esc и Tab всё равно
  // принадлежат панели. Escape перехватывается здесь, поэтому клавиши сессии на время панели молчат.
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const box = dialog.current;
      if (!box) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      // В группе радиокнопок Tab заходит одной точкой: выбранной.
      const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => !(el instanceof HTMLInputElement && el.type === 'radio' && !el.checked),
      );
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (!box.contains(active) || active === box) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const set = useApp.getState().setSettings;
  const screen = useApp((s) => s.screen);
  const currentDocId = useApp((s) => s.currentDocId);
  // Переход закрывает панель без возврата фокуса: прежний элемент исчезает вместе с экраном. Данные уже сохраняются сами.
  const navigate = (to: () => void) => {
    useApp.getState().setSettingsOpen(false);
    to();
  };
  const off = settings.pressure === 'off';

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-bg opacity-80" onClick={close} aria-hidden="true" />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        // Нажатие на пустое место окна оставляет фокус в нём, поэтому Esc и Tab продолжают работать.
        tabIndex={-1}
        className="relative m-4 max-h-[calc(100dvh-32px)] w-full max-w-[26rem] overflow-y-auto overscroll-contain rounded-surface border border-line bg-surface p-4 text-text focus:outline-none"
      >
        <h2 id={`${id}-title`} className="text-h2">
          {ru.settings.title}
        </h2>

        {screen !== 'home' && (
          <section aria-labelledby={`${id}-nav`} data-settings-nav className="mt-3">
            <h3 id={`${id}-nav`} className="text-meta text-text-dim">
              {ru.settings.nav}
            </h3>
            <div className="mt-1 flex flex-wrap gap-2">
              <button type="button" className={navButton} onClick={() => navigate(() => useApp.getState().go('home'))}>
                {ru.settings.navToList}
              </button>
              <button type="button" className={navButton} onClick={() => navigate(() => useApp.getState().startNewText())}>
                {ru.settings.navNewText}
              </button>
              <button
                type="button"
                className={navButton}
                disabled={!currentDocId}
                onClick={() => navigate(() => currentDocId && useApp.getState().restartDocument(currentDocId, ru.result.retrySuffix))}
              >
                {ru.settings.navRetry}
              </button>
            </div>
          </section>
        )}

        <Segmented legend={ru.theme.label} name={`${id}-theme`} value={settings.theme} options={THEMES.map((t) => ({ value: t, label: ru.theme[t] }))} onChange={(theme) => set({ theme })} />

        <div>
          <Segmented legend={ru.settings.blockSize} name={`${id}-size`} value={settings.defaultBlockSize} options={SIZES} onChange={(size) => set({ defaultBlockSize: size })} />
          <p className="mt-1 text-meta text-text-dim">{ru.settings.blockSizeNote}</p>
        </div>

        <Segmented legend={ru.settings.writingFont} name={`${id}-font`} value={settings.writingFont} options={FONTS} onChange={(font) => set({ writingFont: font })} />

        <section className="mt-6 border-t border-line pt-4" aria-labelledby={`${id}-strict`}>
          <h3 id={`${id}-strict`} className="text-ui font-medium">
            {ru.settings.strict}
          </h3>
          <p className="mt-1 text-meta text-text-dim">{ru.settings.strictNote}</p>

          <div className="mt-3">
            <label className="flex min-h-10 cursor-pointer items-center gap-2 text-ui">
              <input
                type="checkbox"
                checked={!settings.allowPaste}
                onChange={(e) => set({ allowPaste: !e.currentTarget.checked })}
                aria-describedby={`${id}-paste`}
                className="size-4 accent-ink"
              />
              {ru.settings.blockPaste}
            </label>
            <p id={`${id}-paste`} className="pl-6 text-meta text-text-dim">
              {ru.settings.blockPasteNote}
            </p>
          </div>

          <Group title={ru.settings.pressure}>
            {MODES.map(({ mode, label, note }) => (
              <Choice key={mode} name={`${id}-pressure`} checked={settings.pressure === mode} onChange={() => set({ pressure: mode })} label={label} note={note} noteId={`${id}-p-${mode}`} />
            ))}
          </Group>

          <div className={`mt-2 ${off ? 'opacity-60' : ''}`}>
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
        </section>

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
