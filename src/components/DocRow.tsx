import { useEffect, useRef, useState } from 'react';
import { doneCount, isFinished, screenForDoc, type DocScreen } from '../lib/doc';
import { FIELD_NAMES, inputProps } from '../lib/fieldAttrs';
import { formatDocDate } from '../lib/format';
import { ru } from '../i18n/ru';
import type { Doc } from '../lib/types';

interface Props {
  doc: Doc;
  now: number;
  onOpen: (doc: Doc, screen: DocScreen) => void;
  onRename: (doc: Doc, title: string) => void;
  onDelete: (doc: Doc) => void;
}

type Mode = 'view' | 'rename' | 'confirm';

const quiet =
  'min-h-10 rounded-surface px-2 text-meta text-text-dim transition-colors duration-[120ms] hover:text-text';

/** Строка списка: название, прогресс, дата и действия. Переименование и подтверждение удаления идут прямо в строке. */
export function DocRow({ doc, now, onOpen, onRename, onDelete }: Props) {
  const [mode, setMode] = useState<Mode>('view');
  const [draft, setDraft] = useState(doc.title);
  const input = useRef<HTMLInputElement>(null);
  const cancelBtn = useRef<HTMLButtonElement>(null);
  const renameBtn = useRef<HTMLButtonElement>(null);
  const deleteBtn = useRef<HTMLButtonElement>(null);
  const skipCommit = useRef(false);
  const restoreFocus = useRef<'rename' | 'delete' | null>(null);

  useEffect(() => {
    if (mode === 'rename') {
      input.current?.focus();
      input.current?.select();
    } else if (mode === 'confirm') {
      cancelBtn.current?.focus();
    } else if (restoreFocus.current) {
      (restoreFocus.current === 'rename' ? renameBtn : deleteBtn).current?.focus();
      restoreFocus.current = null;
    }
  }, [mode]);

  const finished = isFinished(doc);
  const total = doc.blocks.length;

  const startRename = () => {
    skipCommit.current = false;
    setDraft(doc.title);
    setMode('rename');
  };
  const endRename = (commit: boolean) => {
    if (skipCommit.current) return;
    skipCommit.current = true;
    if (commit && draft.trim() && draft.trim() !== doc.title) onRename(doc, draft);
    restoreFocus.current = 'rename';
    setMode('view');
  };

  return (
    <li className="doc-row grid grid-cols-[auto_1fr] items-center gap-x-4 border-b border-line py-2 sm:grid-cols-[minmax(0,1fr)_5rem_6rem]">
      {mode === 'rename' ? (
        <input
          ref={input}
          {...inputProps(FIELD_NAMES.title)}
          value={draft}
          aria-label={ru.home.doc.renameLabel}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => endRename(true)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== 'Escape') return;
            // preventDefault обязателен: фокус уходит на кнопку «Переименовать» ещё во время этого нажатия,
            // и без него браузер доставил бы тот же Enter кнопке, а она снова включила бы переименование.
            e.preventDefault();
            endRename(e.key === 'Enter');
          }}
          className="col-span-2 min-h-10 min-w-0 rounded-surface border border-line bg-surface px-2 text-ui text-text sm:col-span-3"
        />
      ) : (
        <>
          <span className="col-span-2 min-w-0 truncate text-ui text-text sm:col-span-1">{doc.title}</span>
          <span className="text-meta tabular-nums text-text-dim">
            {finished ? ru.home.doc.finished : ru.progress(doneCount(doc), total)}
          </span>
          <span className="text-meta text-text-dim">{formatDocDate(doc.updatedAt, now, ru.home.doc)}</span>
          {mode === 'confirm' ? (
            <div data-persist className="row-actions col-span-2 flex-wrap items-center gap-x-2 sm:col-span-3">
              <span className="text-meta text-text-dim">{ru.home.doc.deleteConfirm}</span>
              <button
                type="button"
                onClick={() => onDelete(doc)}
                className="min-h-10 rounded-surface px-2 text-meta text-danger transition-colors duration-[120ms] hover:text-text"
              >
                {ru.home.doc.delete}
              </button>
              <button
                ref={cancelBtn}
                type="button"
                onClick={() => {
                  restoreFocus.current = 'delete';
                  setMode('view');
                }}
                className={quiet}
              >
                {ru.home.doc.cancel}
              </button>
            </div>
          ) : (
            <div className="row-actions col-span-2 sm:col-span-3">
              <button
                type="button"
                onClick={() => onOpen(doc, screenForDoc(doc))}
                className="min-h-10 rounded-surface px-2 text-meta text-ink transition-colors duration-[120ms] hover:text-text"
              >
                {finished ? ru.home.doc.open : ru.home.doc.continue}
              </button>
              <button ref={renameBtn} type="button" onClick={startRename} className={quiet}>
                {ru.home.doc.rename}
              </button>
              <button ref={deleteBtn} type="button" onClick={() => setMode('confirm')} className={quiet}>
                {ru.home.doc.delete}
              </button>
            </div>
          )}
        </>
      )}
    </li>
  );
}
