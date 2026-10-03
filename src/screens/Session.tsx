import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SaveErrorNotice } from '../components/SaveErrorNotice';
import { HintBar } from '../components/session/HintBar';
import { HintPanel } from '../components/session/HintPanel';
import { PreviousText } from '../components/session/PreviousText';
import { keepFocus } from '../components/session/keepFocus';
import { ReadingText } from '../components/session/ReadingText';
import { WritingField, type FieldCounts } from '../components/session/WritingField';
import { runDissolve, type DissolveRun } from '../components/session/dissolveAnimation';
import { useIdleHide } from '../components/session/useIdleHide';
import { usePressure } from '../components/session/usePressure';
import { useVisualViewport } from '../components/session/useVisualViewport';
import { ru } from '../i18n/ru';
import { advance } from '../lib/activity';
import { BLOCK_IN_MS, BLOCK_IN_SHIFT_PX, MAX_DISSOLVE_MS, PAUSE_MS } from '../lib/dissolve';
import { PEEK_MAX_MS, endPeek as countPeekTime, openLevel, startPeek as countPeek, type HintLevel } from '../lib/hints';
import { effectiveMode } from '../lib/pressure';
import { canFinish, completeBlock, frontierIndex, initialPhase, patchBlock, startWriting, type Phase } from '../lib/session';
import { detectLang } from '../lib/tokens';
import type { Block, Doc } from '../lib/types';
import { useApp } from '../store/app';

const primary =
  'min-h-12 rounded-surface bg-ink px-8 text-ui font-medium text-bg transition-colors duration-[120ms] hover:bg-ink-hover';
const quiet = 'min-h-10 rounded-surface px-2 text-meta text-text-dim transition-colors duration-[120ms] hover:text-text';

/** Горячие клавиши подсказок по KeyboardEvent.code, чтобы не зависеть от раскладки (SPEC §3.5). */
const HINT_KEYS: Record<string, 1 | 2 | 3 | 4> = {
  Digit1: 1, Digit2: 2, Digit3: 3, Digit4: 4,
  Numpad1: 1, Numpad2: 2, Numpad3: 3, Numpad4: 4,
};
const PEEK_END_KEYS = new Set(['Digit4', 'Numpad4', 'AltLeft', 'AltRight']);
const PEEK_FADE_MS = 250;
const now = () => Date.now();

/** Физическая клавиатура есть там, где есть наведение и точный указатель; на телефоне про Alt не говорим. */
const hasPhysicalKeyboard = () => typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

interface StageProps {
  doc: Doc;
  index: number;
  /** Открыть для правки уже завершённый блок; null возвращает к первому незавершённому. */
  onEdit: (index: number | null) => void;
}

/**
 * Один блок сессии: reading → dissolving → writing → done.
 * Компонент создаётся заново для каждого блока (key = индекс), так что состояние не тянется между блоками.
 */
function Stage({ doc, index, onEdit }: StageProps) {
  const total = doc.blocks.length;
  const block = doc.blocks[index]!;
  const editing = index < frontierIndex(doc);
  const settings = useApp((s) => s.settings);
  const settingsOpen = useApp((s) => s.settingsOpen);
  const lang = useMemo(() => detectLang(doc.source), [doc.source]);
  const reducedMotion = useReducedMotion();

  const [phase, setPhase] = useState<Phase>(() => initialPhase(block));
  const [draft, setDraft] = useState(block.userText);
  const [message, setMessage] = useState<'empty' | 'paste' | null>(null);
  const [open, setOpen] = useState<Record<HintLevel, boolean>>({ 1: false, 2: false, 3: false });
  const [peek, setPeek] = useState<'off' | 'in' | 'out'>('off');

  const root = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const reading = useRef<HTMLDivElement>(null);
  const rememberButton = useRef<HTMLButtonElement>(null);
  const clock = useRef<number | null>(null);
  const run = useRef<DissolveRun | null>(null);
  const messageTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const peekStart = useRef<number | null>(null);
  const peekLimit = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const peekFade = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const vignette = useRef<HTMLDivElement>(null);

  useVisualViewport(root);
  const chromeVisible = useIdleHide(phase === 'writing');

  // Уже написанное меняется редко, а doc.blocks при каждой букве новый. Без ключа по содержимому список
  // пересчитывался бы на каждое нажатие и сбрасывал прокрутку, если читаешь ранние блоки.
  const previousKey = JSON.stringify(doc.blocks.slice(0, index).map((b) => b.userText).filter((t) => t.trim() !== ''));
  const previous = useMemo(() => JSON.parse(previousKey) as string[], [previousKey]);

  // --- запись в документ -------------------------------------------------------------------

  const patch = (change: (b: Block) => Partial<Block>) => useApp.getState().updateDoc(doc.id, (d) => patchBlock(d, index, change));

  const tick = () => {
    const r = advance(clock.current, Date.now());
    clock.current = r.last;
    return r.ms;
  };
  const flushActive = () => {
    const ms = tick();
    if (ms > 0) patch((b) => ({ activeMs: b.activeMs + ms }));
  };

  const showMessage = (kind: 'empty' | 'paste') => {
    clearTimeout(messageTimer.current);
    setMessage(kind);
    if (kind === 'paste') messageTimer.current = setTimeout(() => setMessage(null), 4000);
  };

  const onFieldChange = (value: string, counts: FieldCounts) => {
    setDraft(value);
    setMessage(null);
    const ms = tick();
    patch((b) => ({
      userText: value,
      typedChars: b.typedChars + counts.typed,
      pastedChars: b.pastedChars + counts.pasted,
      activeMs: b.activeMs + ms,
    }));
  };

  // --- давление (SPEC §7) -----------------------------------------------------------------

  // Стёртое слово меняет только текст: typedChars и pastedChars не уменьшаются и не растут, activeMs не копится.
  const onErase = (value: string) => {
    setDraft(value);
    patch(() => ({ userText: value }));
  };

  const pressure = usePressure({
    // Правка завершённого блока: давление выключено полностью, в любом режиме.
    mode: effectiveMode(settings.pressure, block.status),
    delaySec: settings.pressureDelaySec,
    active: phase === 'writing',
    paused: { hint: open[1] || open[2] || open[3], peek: peek !== 'off', modal: settingsOpen },
    field,
    vignette,
    lang,
    reduced: !!reducedMotion,
    onErase,
  });

  // --- подсказки (SPEC §3.4) ---------------------------------------------------------------

  /** Ступени 1–3 включаются и выключаются. В статистику идёт каждое открытие. */
  const toggleLevel = (level: HintLevel) => {
    if (phase !== 'writing') return;
    const opening = !open[level];
    setOpen((o) => ({ ...o, [level]: opening }));
    if (opening) patch((b) => ({ hints: openLevel(b.hints, level) }));
  };

  /** Ступень 4: одно удержание = один peek. Длится, пока держат, но не больше PEEK_MAX_MS. */
  const beginPeek = () => {
    if (phase !== 'writing' || peekStart.current !== null) return;
    peekStart.current = now();
    clearTimeout(peekFade.current);
    setPeek('in');
    patch((b) => ({ hints: countPeek(b.hints) }));
    peekLimit.current = setTimeout(() => finishPeek(), PEEK_MAX_MS);
  };

  const finishPeek = () => {
    const started = peekStart.current;
    if (started === null) return;
    peekStart.current = null;
    clearTimeout(peekLimit.current);
    setPeek('out');
    peekFade.current = setTimeout(() => setPeek('off'), PEEK_FADE_MS);
    patch((b) => ({ hints: countPeekTime(b.hints, now() - started) }));
  };

  /** Esc: закрыть открытые подсказки. */
  const closeHints = () => {
    setOpen({ 1: false, 2: false, 3: false });
    finishPeek();
  };

  // --- переходы ----------------------------------------------------------------------------

  /**
   * «Запомнил». Поле письма уже в DOM (скрыто opacity), и фокус на него ставится прямо здесь, синхронно:
   * на iOS экранная клавиатура открывается только при фокусе внутри пользовательского жеста.
   * Фокус по таймеру после растворения клавиатуру бы не открыл.
   */
  const remember = () => {
    if (phase !== 'reading') return;
    field.current?.focus({ preventScroll: true });
    flushActive();
    useApp.getState().updateDoc(doc.id, (d) => startWriting(d, index));
    setPhase('dissolving');
  };

  const done = () => {
    if (phase !== 'writing') return;
    if (!canFinish(draft)) {
      showMessage('empty');
      field.current?.focus({ preventScroll: true });
      return;
    }
    flushActive();
    // Закрываем экранную клавиатуру: следующий блок читается на всём экране.
    field.current?.blur();
    useApp.getState().updateDoc(doc.id, (d) => completeBlock(d, index, Date.now()));
    const fresh = useApp.getState().docs.find((d) => d.id === doc.id);
    if (!fresh) return;
    const front = frontierIndex(fresh);
    if (editing) onEdit(index + 1 >= front ? null : index + 1);
    else if (front >= fresh.blocks.length) useApp.getState().go('result');
    // Иначе первый незавершённый блок сменился, и экран пересоздаст этот компонент для следующего.
  };

  const leave = (to: () => void) => {
    flushActive();
    to();
  };

  // Свежие обработчики для слушателей, которые подписываются один раз.
  const api = useRef({ phase, remember, done, flushActive, toggleLevel, beginPeek, finishPeek, closeHints });
  useEffect(() => {
    api.current = { phase, remember, done, flushActive, toggleLevel, beginPeek, finishPeek, closeHints };
  });

  // --- растворение -------------------------------------------------------------------------

  useEffect(() => {
    if (phase !== 'dissolving') return;
    const text = reading.current;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let alive = true;
    let pause: ReturnType<typeof setTimeout> | undefined;
    // Страховка: если анимация почему-то не сообщит о конце, письмо всё равно откроется.
    const guard = setTimeout(() => alive && setPhase('writing'), MAX_DISSOLVE_MS + PAUSE_MS + 500);
    if (text) {
      const r = runDissolve(text, reduced);
      run.current = r;
      void r.finished.then(() => {
        if (alive) pause = setTimeout(() => setPhase('writing'), PAUSE_MS);
      });
    }
    return () => {
      alive = false;
      clearTimeout(pause);
      clearTimeout(guard);
      run.current?.cancel();
      run.current = null;
    };
  }, [phase]);

  // Вход в writing: фокус (на десктопе и после перезагрузки), каретка в конец, прокрутка к полю.
  useEffect(() => {
    if (phase !== 'writing') return;
    const ta = field.current;
    if (!ta) return;
    if (document.activeElement !== ta) ta.focus({ preventScroll: true });
    ta.setSelectionRange(ta.value.length, ta.value.length);
    if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [phase]);

  // --- окружение ---------------------------------------------------------------------------

  useEffect(() => {
    clock.current = Date.now();
    if (block.status === 'pending') rememberButton.current?.focus({ preventScroll: true });
    // Сессия занимает весь экран: страница под ней прокручиваться не должна.
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = 'hidden';
    html.style.overscrollBehavior = 'none';
    return () => {
      html.style.overflow = prev;
      html.style.overscrollBehavior = '';
      api.current.finishPeek();
      clearTimeout(peekLimit.current);
      clearTimeout(peekFade.current);
      api.current.flushActive();
    };
    // только при появлении и уходе компонента
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Приложение свернули или переключили вкладку: время не копим, а растворение, которое при этом
  // могли заморозить, доводим до конца. Блок в хранилище уже в writing, так что возврат тоже откроет письмо.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        api.current.finishPeek();
        api.current.flushActive();
        clock.current = null;
        if (api.current.phase === 'dissolving') {
          run.current?.finish();
          setPhase('writing');
        }
      } else {
        clock.current = Date.now();
      }
    };
    const onWindowBlur = () => api.current.finishPeek();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, []);

  // Горячие клавиши по KeyboardEvent.code (SPEC §3.5): Space в reading, Ctrl/Cmd+Enter в writing.
  // На Shift, Ctrl+Space, Cmd+Space и ` ничего не вешаем.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Пока открыта панель настроек, клавиши принадлежат ей.
      if (e.repeat || useApp.getState().settingsOpen) return;
      const bare = !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
      if (e.code === 'Space' && bare && api.current.phase === 'reading') {
        // На другой кнопке (например, «К списку») пробел остаётся её нажатием.
        const other = (e.target as HTMLElement | null)?.closest('button, a, input, textarea, select, [role="button"]');
        if (other && other !== rememberButton.current) return;
        e.preventDefault();
        api.current.remember();
      } else if ((e.code === 'Enter' || e.code === 'NumpadEnter') && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && api.current.phase === 'writing') {
        e.preventDefault();
        api.current.done();
      } else if (api.current.phase === 'writing') {
        // Alt+1, Alt+2, Alt+3: ступени подсказок, Alt+4 (удерживать): подглядеть, Esc: закрыть подсказки.
        const level = HINT_KEYS[e.code];
        if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && level) {
          e.preventDefault();
          if (level === 4) api.current.beginPeek();
          else api.current.toggleLevel(level);
        } else if (e.code === 'Escape' && bare) {
          e.preventDefault();
          api.current.closeHints();
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (PEEK_END_KEYS.has(e.code)) api.current.finishPeek();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // --- разметка ----------------------------------------------------------------------------

  const writing = phase === 'writing';
  const anyOpen = open[1] || open[2] || open[3];
  const progress = ru.progress(index + 1, total);

  return (
    <div
      ref={root}
      data-phase={phase}
      className="session-root fixed inset-x-0 z-50 flex flex-col bg-bg text-text"
      style={{ top: 'var(--vv-top, 0px)', height: 'var(--vv-h, 100dvh)' }}
    >
      <h1 className="sr-only">{ru.screens.session}</h1>

      {/* Виньетка давления (DESIGN §6.5): под всем содержимым сессии (z-index ниже потока), касаний не ловит,
          кнопки и поле рисуются поверх. Меняется только opacity. */}
      <div ref={vignette} aria-hidden="true" data-vignette className="pressure-vignette pointer-events-none absolute inset-0 -z-10" />

      <div className="h-0.5 shrink-0">
        <div className="h-full bg-ink" style={{ width: `${((index + 1) / total) * 100}%` }} />
      </div>

      <div className="session-top flex shrink-0 items-start justify-between gap-2 px-4 pt-2">
        <span className="flex min-h-10 shrink-0 items-center whitespace-nowrap text-meta tabular-nums text-text-dim">{progress}</span>
        <div className="session-chrome -mr-2 flex min-w-0 flex-wrap justify-end" data-hidden={!chromeVisible}>
          {index > 0 && (
            <button type="button" className={quiet} onClick={() => leave(() => onEdit(index - 1))}>
              {ru.session.backToPrevious}
            </button>
          )}
          <button type="button" className={quiet} onClick={() => leave(() => useApp.getState().go('home'))}>
            {ru.session.toList}
          </button>
          {/* Не забираем фокус у поля: после закрытия панели он вернётся туда, и клавиатура снова откроется. */}
          <button
            type="button"
            aria-haspopup="dialog"
            className={quiet}
            onPointerDown={keepFocus}
            onMouseDown={keepFocus}
            onClick={() => useApp.getState().setSettingsOpen(true)}
          >
            {ru.settings.open}
          </button>
        </div>
      </div>

      <SaveErrorNotice />

      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* Ступени 1–3 закреплены над полем, а не под ним: экранная клавиатура их не закроет,
            и поле с каретками остаётся под рукой. На низком экране панель прокручивается. */}
        {writing && anyOpen && (
          <div className="shrink-0 overflow-y-auto overscroll-contain border-b border-line" style={{ maxHeight: 'calc(var(--vv-h, 100dvh) * 0.38)' }}>
            <div className="mx-auto w-full max-w-[44rem] px-4 py-3">
              <HintPanel text={block.sourceText} phrases={block.keyphrases} lang={lang} open={open} />
            </div>
          </div>
        )}

        <div className="relative min-h-0 flex-1">
          <div ref={scroll} className="absolute inset-0 overflow-y-auto overscroll-contain">
            <div className="mx-auto flex min-h-full w-full max-w-[44rem] flex-col px-4">
              <div className="writing-layer relative my-auto py-6" data-shown={writing}>
                <PreviousText texts={previous} />
                <WritingField
                  fieldRef={field}
                  scrollRef={scroll}
                  value={draft}
                  blocked={!writing}
                  allowPaste={settings.allowPaste}
                  lang={lang}
                  mono={settings.writingFont === 'mono'}
                  label={ru.session.fieldLabel}
                  onChange={onFieldChange}
                  onPasteBlocked={() => showMessage('paste')}
                  onActivity={pressure.activity}
                  onComposition={pressure.composition}
                />
                {message && (
                  <p role="status" className="mt-2 text-meta text-text-dim">
                    {message === 'empty' ? (hasPhysicalKeyboard() ? ru.session.empty : ru.session.emptyTouch) : ru.session.pasteOff}
                  </p>
                )}
              </div>
            </div>
          </div>

          {!writing && (
            <div className="absolute inset-0 overflow-y-auto overscroll-contain">
              <div className="mx-auto flex min-h-full w-full max-w-[44rem] flex-col justify-center px-4 py-6">
                <motion.div
                  initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: BLOCK_IN_SHIFT_PX }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: BLOCK_IN_MS / 1000, ease: [0.4, 0, 0.2, 1] }}
                >
                  <ReadingText text={block.sourceText} kind={block.kind} innerRef={reading} />
                </motion.div>
              </div>
            </div>
          )}

          </div>
        {/* Ступень 4: исходник поверх панели подсказок и области письма, пока держат кнопку. Поле под ним сохраняет
            фокус, клавиатура не закрывается. Перекрываем и панель: на низком окне (клавиатура) места под ней мало.
            Кнопку держат одним пальцем, а длинный блок можно прокрутить другим. */}
        {peek !== 'off' && (
          <div data-peek className="peek absolute inset-0 select-none overflow-y-auto overscroll-contain bg-bg" data-state={peek}>
            <div className="mx-auto flex min-h-full w-full max-w-[44rem] flex-col justify-center px-4 py-6">
              <div className={`reading-column max-w-none text-text ${block.kind === 'heading' ? 'font-medium' : ''}`}>{block.sourceText}</div>
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3">
        <div className={`mx-auto w-full max-w-[44rem] ${writing ? 'sm:flex sm:items-center sm:justify-between sm:gap-4' : 'flex items-center justify-center gap-4'}`}>
          {writing ? (
            <>
              <HintBar
                open={open}
                peeking={peek === 'in'}
                hidden={!chromeVisible && !anyOpen && peek === 'off'}
                onToggle={toggleLevel}
                onPeekStart={beginPeek}
                onPeekEnd={finishPeek}
              />
              <div className="mt-2 flex items-center gap-2 sm:mt-0 sm:gap-4">
                {/* Настройки без закрытия клавиатуры: верхняя панель на низком экране скрыта. Кнопка не берёт фокус у поля. */}
                <button
                  type="button"
                  aria-label={ru.settings.open}
                  aria-haspopup="dialog"
                  className="flex size-12 shrink-0 items-center justify-center rounded-surface border border-line text-text-dim transition-colors duration-[120ms] hover:text-text"
                  onPointerDown={keepFocus}
                  onMouseDown={keepFocus}
                  onClick={() => useApp.getState().setSettingsOpen(true)}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                    <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
                    <circle cx="16" cy="7" r="2" />
                    <circle cx="8" cy="17" r="2" />
                  </svg>
                </button>
                <button type="button" className={`${primary} flex-1 sm:flex-none`} onPointerDown={keepFocus} onMouseDown={keepFocus} onClick={done}>
                  {ru.session.done}
                </button>
                <span className="kbd-hint text-meta text-text-dim">{isMac ? ru.session.doneKeyMac : ru.session.doneKey}</span>
              </div>
            </>
          ) : (
            <>
              <button
                ref={rememberButton}
                type="button"
                className={`${primary} flex-1 sm:flex-none ${phase === 'dissolving' ? 'invisible' : ''}`}
                onClick={remember}
              >
                {ru.session.remember}
              </button>
              <span className={`kbd-hint text-meta text-text-dim ${phase === 'dissolving' ? 'invisible' : ''}`}>{ru.session.rememberKey}</span>
            </>
          )}
        </div>
      </div>

      <p className="sr-only" aria-live="polite">
        {progress}
      </p>
    </div>
  );
}

export function Session() {
  const doc = useApp((s) => s.docs.find((d) => d.id === s.currentDocId));
  const [editIndex, setEditIndex] = useState<number | null>(null);

  const frontier = doc ? frontierIndex(doc) : 0;
  const finished = !!doc && frontier >= doc.blocks.length;

  useEffect(() => {
    if (!doc) useApp.getState().go('home');
    else if (finished) useApp.getState().go('result');
  }, [doc, finished]);

  if (!doc || finished) return null;
  const index = editIndex !== null && editIndex < frontier ? editIndex : frontier;
  return <Stage key={`${doc.id}:${index}`} doc={doc} index={index} onEdit={setEditIndex} />;
}
