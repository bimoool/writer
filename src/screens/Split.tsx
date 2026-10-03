import { useEffect, useMemo, useRef, useState } from 'react';
import { BlockItem } from '../components/split/BlockItem';
import { SizeToggle } from '../components/split/SizeToggle';
import { useSelectionCapture, type BlockSelection } from '../components/split/selection';
import { ru } from '../i18n/ru';
import { addKeyphrase, cutDocBlock, hasProgress, mergeDocBlocks, removeKeyphraseAt, resegmentDoc, setKeyphrases } from '../lib/blocks';
import { detectLang } from '../lib/tokens';
import type { BlockSize, Doc } from '../lib/types';
import { useApp } from '../store/app';

const newId = () => crypto.randomUUID();

type AddResult = 'ok' | 'overlap' | 'empty';

/** Добавляет фразу по выделению. Читает актуальный документ из стора, а не из замыкания. */
function addPhraseFromSelection(sel: BlockSelection): AddResult {
  const { docs, currentDocId, updateDoc } = useApp.getState();
  const doc = docs.find((d) => d.id === currentDocId);
  const index = doc?.blocks.findIndex((b) => b.id === sel.blockId) ?? -1;
  if (!doc || index < 0 || hasProgress(doc)) return 'empty';
  const block = doc.blocks[index]!;
  const result = addKeyphrase(block.keyphrases, block.sourceText, sel.start, sel.end, detectLang(doc.source));
  if (!result.ok) return result.reason;
  updateDoc(doc.id, (d) => setKeyphrases(d, index, result.phrases));
  return 'ok';
}

export function Split() {
  const doc = useApp((s) => s.docs.find((d) => d.id === s.currentDocId));
  const heading = useRef<HTMLHeadingElement>(null);
  const confirmNo = useRef<HTMLButtonElement>(null);
  const focusAfter = useRef<{ id: string; action: 'merge' | 'cut' | 'row' } | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [cutBlockId, setCutBlockId] = useState<string | null>(null);
  const [confirmSize, setConfirmSize] = useState<BlockSize | null>(null);
  const [notice, setNotice] = useState<{ blockId: string; text: string } | null>(null);

  const lang = useMemo(() => detectLang(doc?.source ?? ''), [doc?.source]);
  const editable = !!doc && !hasProgress(doc);

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

  const add = (sel: BlockSelection) => {
    const result = addPhraseFromSelection(sel);
    window.getSelection()?.removeAllRanges();
    if (result === 'overlap') showNotice(sel.blockId, ru.split.overlap);
  };

  const [pending, clearPending] = useSelectionCapture({ enabled: editable, onMouseSelect: add });

  if (!doc) return null;

  const docId = doc.id;
  const edit = (change: (d: Doc) => Doc) => useApp.getState().updateDoc(docId, change);
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

        <ol className="mt-2 list-none">
          {doc.blocks.map((block, i) => (
            <BlockItem
              key={block.id}
              block={block}
              index={i}
              total={doc.blocks.length}
              lang={lang}
              editable={editable}
              cutMode={cutBlockId === block.id}
              notice={notice?.blockId === block.id ? notice.text : null}
              onRemovePhrase={(pi) => {
                const at = indexOf(block.id);
                if (at >= 0) edit((d) => setKeyphrases(d, at, removeKeyphraseAt(d.blocks[at]!.keyphrases, pi)));
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
        <div className="mx-auto flex max-w-[46rem] justify-end px-4 py-3">
          <button
            type="button"
            onClick={() => useApp.getState().openDocument(doc.id, 'session')}
            className="min-h-10 rounded-surface bg-ink px-5 text-ui font-medium text-bg transition-colors duration-[120ms] hover:bg-ink-hover"
          >
            {editable ? ru.split.start : ru.home.doc.continue}
          </button>
        </div>
      </footer>
    </main>
  );
}
