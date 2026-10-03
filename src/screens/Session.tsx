import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SaveErrorNotice } from '../components/SaveErrorNotice';
import { PreviousText } from '../components/session/PreviousText';
import { ReadingText } from '../components/session/ReadingText';
import { WritingField, type FieldCounts } from '../components/session/WritingField';
import { runDissolve, type DissolveRun } from '../components/session/dissolveAnimation';
import { useIdleHide } from '../components/session/useIdleHide';
import { useVisualViewport } from '../components/session/useVisualViewport';
import { ru } from '../i18n/ru';
import { advance } from '../lib/activity';
import { BLOCK_IN_MS, BLOCK_IN_SHIFT_PX, MAX_DISSOLVE_MS, PAUSE_MS } from '../lib/dissolve';
import { canFinish, completeBlock, frontierIndex, initialPhase, patchBlock, startWriting, type Phase } from '../lib/session';
import { detectLang } from '../lib/tokens';
import type { Block, Doc } from '../lib/types';
import { useApp } from '../store/app';

const primary =
  'min-h-12 rounded-surface bg-ink px-8 text-ui font-medium text-bg transition-colors duration-[120ms] hover:bg-ink-hover';
const quiet = 'min-h-10 rounded-surface px-2 text-meta text-text-dim transition-colors duration-[120ms] hover:text-text';

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
  const lang = useMemo(() => detectLang(doc.source), [doc.source]);
  const reducedMotion = useReducedMotion();

  const [phase, setPhase] = useState<Phase>(() => initialPhase(block));
  const [draft, setDraft] = useState(block.userText);
  const [message, setMessage] = useState<'empty' | 'paste' | null>(null);

  const root = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const reading = useRef<HTMLDivElement>(null);
  const rememberButton = useRef<HTMLButtonElement>(null);
  const clock = useRef<number | null>(null);
  const run = useRef<DissolveRun | null>(null);
  const messageTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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
  const api = useRef({ phase, remember, done, flushActive });
  useEffect(() => {
    api.current = { phase, remember, done, flushActive };
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
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Горячие клавиши по KeyboardEvent.code (SPEC §3.5): Space в reading, Ctrl/Cmd+Enter в writing.
  // На Shift, Ctrl+Space, Cmd+Space и ` ничего не вешаем.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
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
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // --- разметка ----------------------------------------------------------------------------

  const writing = phase === 'writing';
  const progress = ru.progress(index + 1, total);

  return (
    <div
      ref={root}
      data-phase={phase}
      className="fixed inset-x-0 z-50 flex flex-col bg-bg text-text"
      style={{ top: 'var(--vv-top, 0px)', height: 'var(--vv-h, 100dvh)' }}
    >
      <h1 className="sr-only">{ru.screens.session}</h1>

      <div className="h-0.5 shrink-0">
        <div className="h-full bg-ink" style={{ width: `${((index + 1) / total) * 100}%` }} />
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 px-4 pt-2">
        <span className="text-meta tabular-nums text-text-dim">{progress}</span>
        <div className="session-chrome -mr-2 flex flex-wrap justify-end" data-hidden={!chromeVisible}>
          {index > 0 && (
            <button type="button" className={quiet} onClick={() => leave(() => onEdit(index - 1))}>
              {ru.session.backToPrevious}
            </button>
          )}
          <button type="button" className={quiet} onClick={() => leave(() => useApp.getState().go('home'))}>
            {ru.session.toList}
          </button>
        </div>
      </div>

      <SaveErrorNotice />

      <div className="relative min-h-0 flex-1">
        <div ref={scroll} className="absolute inset-0 overflow-y-auto overscroll-contain">
          <div className="mx-auto flex min-h-full w-full max-w-[44rem] flex-col px-4">
            <div className="writing-layer my-auto py-6" data-shown={writing}>
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
              />
              {message && (
                <p role="status" className="mt-2 text-meta text-text-dim">
                  {message === 'empty' ? ru.session.empty : ru.session.pasteOff}
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

      <div className="shrink-0 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3">
        <div className={`mx-auto flex w-full max-w-[44rem] items-center gap-4 ${writing ? 'justify-end' : 'justify-center'}`}>
          {writing ? (
            <>
              <button type="button" className={`${primary} flex-1 sm:flex-none`} onClick={done}>
                {ru.session.done}
              </button>
              <span className="kbd-hint text-meta text-text-dim">{isMac ? ru.session.doneKeyMac : ru.session.doneKey}</span>
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
