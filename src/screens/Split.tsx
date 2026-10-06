import { useEffect, useMemo, useRef, useState } from 'react';
import { BlockItem } from '../components/split/BlockItem';
import { SizeToggle } from '../components/split/SizeToggle';
import { useSelectionCapture, type BlockSelection } from '../components/split/selection';
import { ru } from '../i18n/ru';
import { addKeyphrase, cutDocBlock, hasProgress, mergeDocBlocks, removeKeyphraseAt, resegmentDoc, setKeyphrases } from '../lib/blocks';
import { sourceTemplatesFor, spotsByBlock } from '../lib/sourceTemplates';
import { detectLang } from '../lib/tokens';
import type { BlockSize, Doc } from '../lib/types';
import { changed, pushUndo, restoreSnapshot, snapshotOf, type Snapshot } from '../lib/undo';
import { useApp } from '../store/app';
import { isMac } from '../components/platform';

const newId = () => crypto.randomUUID();
const now = () => Date.now();

/** Столько после удаления подсветки слово под курсором ещё считается частью того же двойного щелчка. */
const DOUBLE_CLICK_MS = 700;

type AddResult = 'ok' | 'overlap' | 'empty';

const currentDoc = () => {
  const { docs, currentDocId } = useApp.getState();
  return docs.find((d) => d.id === currentDocId);
};

export function Split() {
  const doc = useApp((s) => s.docs.find((d) => d.id === s.currentDocId));
  const heading = useRef<HTMLHeadingElement>(null);
  const confirmNo = useRef<HTMLButtonElement>(null);
  const focusAfter = useRef<{ id: string; action: 'merge' | 'cut' | 'row' } | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Фраза, убранная только что: слово, выделенное вторым кликом двойного щелчка, новой фразой не становится. */
  const justRemoved = useRef<{ blockId: string; start: number; end: number; at: number } | null>(null);

  const [cutBlockId, setCutBlockId] = useState<string | null>(null);
  const [confirmSize, setConfirmSize] = useState<BlockSize | null>(null);
  const [notice, setNotice] = useState<{ blockId: string; text: string } | null>(null);
  // Стек отмены только в памяти: уход с экрана размонтирует компонент и стек пропадает.
  const undoStack = useRef<Snapshot[]>([]);
  const [undoDepth, setUndoDepth] = useState(0);

  const lang = useMemo(() => detectLang(doc?.source ?? ''), [doc?.source]);
  const editable = !!doc && !hasProgress(doc);
  // Шаблоны исходника считаются сразу при открытии (локально, один раз на документ, см. SPEC §3.2); подсветка по переключателю.
  const [showTemplates, setShowTemplates] = useState(false);
  const templates = useMemo(() => (doc ? sourceTemplatesFor(doc.id, doc.blocks) : null), [doc]);
  const templateSpots = useMemo(() => (templates && doc && showTemplates ? spotsByBlock(templates, doc.blocks) : null), [templates, doc, showTemplates]);

  useEffect(() => {
    if (!doc) useApp.getState().go('home');
  }, [doc]);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  // После склейки и разреза фокус возвращается на ту же кнопку: блок сохраняет id, так что она на месте.
  // Включение режима разреза переводит фокус на первую точку разреза: кнопка «Разрезать» стоит в DOM после текста,
  // и без этого Tab ушёл бы из блока.
  useEffect(() => {
    const target = focusAfter.current;
    if (!target) return;
    focusAfter.current = null;
    const root = document.querySelector<HTMLElement>(`[data-block-id="${target.id}"]`);
    const find = (selector: string) => root?.querySelector<HTMLElement>(selector);
    const other = target.action === 'merge' ? 'cut' : 'merge';
    const el =
      (target.action === 'row' ? find('.cut-row') : null) ??
      find(`[data-action="${target.action === 'row' ? 'cut' : target.action}"]`) ??
      find(`[data-action="${other}"]`) ??
      find('[data-block-text]');
    el?.focus();
  }, [doc?.blocks, cutBlockId]);

  useEffect(() => {
    if (confirmSize) confirmNo.current?.focus();
  }, [confirmSize]);

  const showNotice = (blockId: string, text: string) => {
    clearTimeout(noticeTimer.current);
    setNotice({ blockId, text });
    noticeTimer.current = setTimeout(() => setNotice(null), 4000);
  };

  /** Любая правка разбивки идёт через эту функцию: она же кладёт состояние до правки в стек отмены. */
  const edit = (change: (d: Doc) => Doc) => {
    const before = currentDoc();
    if (!before) return;
    useApp.getState().updateDoc(before.id, change);
    const after = currentDoc();
    if (after && changed(before, after)) {
      undoStack.current = pushUndo(undoStack.current, snapshotOf(before));
      setUndoDepth(undoStack.current.length);
    }
  };

  /** Добавляет фразу в блок. Читает актуальный документ из стора, а не из замыкания. */
  const addPhrase = (blockId: string, start: number, end: number): AddResult => {
    const d = currentDoc();
    const at = d?.blocks.findIndex((b) => b.id === blockId) ?? -1;
    if (!d || at < 0 || hasProgress(d)) return 'empty';
    const block = d.blocks[at]!;
    const result = addKeyphrase(block.keyphrases, block.sourceText, start, end, detectLang(d.source));
    if (!result.ok) {
      if (result.reason === 'overlap') showNotice(blockId, ru.split.overlap);
      return result.reason;
    }
    edit((x) => setKeyphrases(x, at, result.phrases));
    return 'ok';
  };

  const undo = () => {
    const snap = undoStack.current.pop();
    const d = currentDoc();
    if (!snap || !d) return;
    useApp.getState().updateDoc(d.id, (x) => restoreSnapshot(x, snap));
    setUndoDepth(undoStack.current.length);
    setCutBlockId(null);
    setConfirmSize(null);
    // Кнопка гаснет, когда отменять нечего: фокус не должен пропасть.
    if (undoStack.current.length === 0) heading.current?.focus();
  };
  const undoRef = useRef(undo);
  const confirmRef = useRef(confirmSize);
  useEffect(() => {
    undoRef.current = undo;
    confirmRef.current = confirmSize;
  });

  // Ctrl/Cmd+Z и Ctrl/Cmd+Enter по физической клавише: работают и в другой раскладке.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.defaultPrevented || e.repeat) return;
      // «Начать»; пока открыт вопрос о смене размера, сначала нужно ответить на него.
      if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !useApp.getState().settingsOpen && !confirmRef.current) {
        const d = currentDoc();
        if (!d) return;
        e.preventDefault();
        useApp.getState().openDocument(d.id, 'session');
        return;
      }
      if (e.code !== 'KeyZ') return;
      if ((e.target as HTMLElement | null)?.closest('input, textarea, [contenteditable="true"]')) return;
      e.preventDefault();
      undoRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const add = (sel: BlockSelection) => {
    const gone = justRemoved.current;
    if (gone && gone.blockId === sel.blockId && now() - gone.at < DOUBLE_CLICK_MS && sel.start < gone.end && sel.end > gone.start) {
      window.getSelection()?.removeAllRanges();
      return;
    }
    addPhrase(sel.blockId, sel.start, sel.end);
    window.getSelection()?.removeAllRanges();
  };

  const [pending, clearPending] = useSelectionCapture({ enabled: editable, onMouseSelect: add });

  if (!doc) return null;

  const docId = doc.id;
  /** Индекс блока по id в актуальном документе: индексы в замыкании могли устареть. */
  const indexOf = (blockId: string) => useApp.getState().docs.find((d) => d.id === docId)?.blocks.findIndex((b) => b.id === blockId) ?? -1;

  const applySize = (size: BlockSize) => {
    edit((d) => resegmentDoc(d, size, newId));
    setCutBlockId(null);
    setConfirmSize(null);
  };
  const requestSize = (size: BlockSize) => {
    if (size === doc.blockSize) return;
    if (doc.manualEdits) setConfirmSize(size);
    else applySize(size);
  };

  return (
    <main>
      {/* Липкая только на широких экранах: на 360px две строки шапки вместе с подвалом закрывали пятую часть экрана. */}
      <header className="z-10 border-b border-line bg-bg sm:sticky sm:top-0">
        <div className="mx-auto flex max-w-[46rem] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
          <button
            type="button"
            onClick={() => useApp.getState().go('home')}
            className="-ml-2 min-h-10 rounded-surface px-2 text-ui text-text-dim transition-colors duration-[120ms] hover:text-text"
          >
            <span aria-hidden="true">← </span>
            {ru.split.back}
          </button>
          <h1 ref={heading} tabIndex={-1} aria-live="polite" className="text-ui font-medium text-text focus:outline-none">
            {ru.split.title(doc.blocks.length)}
          </h1>
          <div className="w-full sm:ml-auto sm:w-auto">
            <SizeToggle value={doc.blockSize} disabled={!editable} onChange={requestSize} />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[46rem] px-4">
        {confirmSize && (
          <div
            className="mt-4 rounded-surface border border-line bg-surface p-4"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setConfirmSize(null);
            }}
          >
            <p role="alert" className="text-ui text-text">
              {ru.split.confirmText}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-x-4">
              <button
                type="button"
                onClick={() => applySize(confirmSize)}
                className="min-h-10 rounded-surface bg-ink px-4 text-ui font-medium text-bg transition-colors duration-[120ms] hover:bg-ink-hover"
              >
                {ru.split.confirmYes}
              </button>
              <button
                ref={confirmNo}
                type="button"
                onClick={() => setConfirmSize(null)}
                className="min-h-10 rounded-surface px-2 text-ui text-text-dim transition-colors duration-[120ms] hover:text-text"
              >
                {ru.split.confirmNo}
              </button>
            </div>
          </div>
        )}

        <p className="mt-4 text-meta text-text-dim">{editable ? ru.split.hint : ru.split.locked}</p>

        {templates && (
          <div aria-label={ru.split.templates.label} role="group" className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-meta text-text-dim">
            {templates.counts.total === 0 ? (
              <p role="status">{ru.split.templates.none}</p>
            ) : (
              <>
                <p role="status">
                  {ru.split.templates.found(templates.counts.total)} (
                  <span className="tpl-cliche">{ru.split.templates.cliche}</span> {templates.counts.cliche},{' '}
                  <span className="tpl-junk">{ru.split.templates.junk}</span> {templates.counts.junk},{' '}
                  <span className="tpl-rhythm">{ru.split.templates.rhythm}</span> {templates.counts.rhythm})
                </p>
                <button
                  type="button"
                  aria-pressed={showTemplates}
                  onClick={() => setShowTemplates(!showTemplates)}
                  className={`min-h-10 rounded-surface px-2 text-meta transition-colors duration-[120ms] hover:text-text ${showTemplates ? 'bg-surface text-text' : ''}`}
                >
                  {ru.split.templates.toggle}
                </button>
              </>
            )}
          </div>
        )}

        <ol className="mt-2 list-none">
          {doc.blocks.map((block, i) => (
            <BlockItem
              key={block.id}
              block={block}
              index={i}
              total={doc.blocks.length}
              lang={lang}
              editable={editable}
              templates={templateSpots?.get(block.id)}
              cutMode={cutBlockId === block.id}
              notice={notice?.blockId === block.id ? notice.text : null}
              onRemovePhrase={(pi) => {
                const at = indexOf(block.id);
                if (at < 0) return;
                const phrase = useApp.getState().docs.find((d) => d.id === docId)?.blocks[at]?.keyphrases[pi];
                if (phrase) justRemoved.current = { blockId: block.id, start: phrase.start, end: phrase.end, at: now() };
                edit((d) => setKeyphrases(d, at, removeKeyphraseAt(d.blocks[at]!.keyphrases, pi)));
              }}
              onMerge={() => {
                const at = indexOf(block.id);
                if (at < 0) return;
                focusAfter.current = { id: block.id, action: 'merge' };
                edit((d) => mergeDocBlocks(d, at));
              }}
              onToggleCut={() => {
                const enabling = cutBlockId !== block.id;
                focusAfter.current = { id: block.id, action: enabling ? 'row' : 'cut' };
                setCutBlockId(enabling ? block.id : null);
              }}
              onAddPhrase={(range) => addPhrase(block.id, range.start, range.end)}
              onCut={(offset) => {
                const at = indexOf(block.id);
                if (at < 0) return;
                focusAfter.current = { id: block.id, action: 'cut' };
                setCutBlockId(null);
                edit((d) => cutDocBlock(d, at, offset, newId));
              }}
            />
          ))}
        </ol>
      </div>

      {pending && (
        // Закреплена над подвалом, а не у выделения: у выделения на телефоне системные ручки и меню,
        // а текст рядом нужен для выбора следующих слов.
        <button
          type="button"
          className="fixed bottom-20 right-4 z-20 min-h-10 rounded-surface bg-ink px-4 text-meta font-medium text-bg transition-colors duration-[120ms] hover:bg-ink-hover"
          // Не даём кнопке снять выделение до клика.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            add(pending);
            clearPending();
          }}
        >
          {ru.split.addPhrase}
        </button>
      )}

      <footer className="sticky bottom-0 z-10 border-t border-line bg-bg">
        <div className="mx-auto flex max-w-[46rem] flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
          <button
            type="button"
            disabled={undoDepth === 0}
            aria-keyshortcuts="Control+Z Meta+Z"
            onClick={undo}
            className="-ml-2 min-h-10 rounded-surface px-2 text-ui text-text-dim transition-colors duration-[120ms] enabled:hover:text-text disabled:opacity-50"
          >
            {ru.split.undo}
          </button>
          <div className="ml-auto flex items-center gap-3">
            <span className="kbd-hint text-meta text-text-dim max-sm:hidden">{isMac ? ru.split.startKeyMac : ru.split.startKey}</span>
            <button
              type="button"
              aria-keyshortcuts="Control+Enter Meta+Enter"
              onClick={() => useApp.getState().openDocument(doc.id, 'session')}
              className="min-h-10 rounded-surface bg-ink px-5 text-ui font-medium text-bg transition-colors duration-[120ms] hover:bg-ink-hover"
            >
              {editable ? ru.split.start : ru.home.doc.continue}
            </button>
          </div>
        </div>
      </footer>
    </main>
  );
}
