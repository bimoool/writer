import { useRef, useState } from 'react';
import { BackupBar } from '../components/BackupBar';
import { DocRow } from '../components/DocRow';
import { useFileDrop } from '../components/useFileDrop';
import { SAMPLE_TEXT } from '../i18n/sample';
import { ru } from '../i18n/ru';
import { importFile, validateText, type ImportErrorKind } from '../lib/io/import';
import { useApp } from '../store/app';

const ERROR_TEXT: Record<ImportErrorKind, string> = {
  unreadable: ru.errors.importUnreadable,
  tooLong: ru.errors.tooLong,
  empty: ru.errors.empty,
};

export function Home() {
  const docs = useApp((s) => s.docs);
  const [text, setText] = useState('');
  const [error, setError] = useState<ImportErrorKind | null>(null);
  const [now] = useState(() => Date.now());
  const fileInput = useRef<HTMLInputElement>(null);

  /** Создаёт документ и открывает разбивку. Ничего не создаёт, если текст не прошёл проверку. */
  const begin = (source: string, title?: string) => {
    const problem = validateText(source);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    const { createDocument, openDocument } = useApp.getState();
    openDocument(createDocument(source, { title }).id, 'split');
  };

  /** Берём только первый файл. Остальные игнорируем: документ создаётся из одного источника. */
  const importFirst = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    const result = await importFile(file);
    if (result.ok) begin(result.text, result.title);
    else setError(result.error);
  };

  const dragging = useFileDrop((files) => void importFirst(files));

  return (
    <main className="mx-auto w-full max-w-[44rem] px-4 pb-20 pt-10">
      <h1 id="home-prompt" className="mb-4 text-h2 font-serif text-text">
        {ru.home.prompt}
      </h1>

      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        aria-labelledby="home-prompt"
        placeholder={ru.home.placeholder}
        rows={9}
        className={`reading-column block min-h-56 w-full max-w-none resize-y rounded-surface border bg-surface p-4 text-text transition-colors duration-[120ms] placeholder:text-text-ghost ${
          dragging ? 'border-ink' : 'border-line'
        }`}
      />

      <div className="mt-3 flex flex-wrap items-center gap-x-5">
        <button
          type="button"
          disabled={!text.trim()}
          onClick={() => begin(text)}
          className="min-h-10 rounded-surface bg-ink px-5 text-ui font-medium text-bg transition-colors duration-[120ms] enabled:hover:bg-ink-hover disabled:bg-line disabled:text-text-ghost"
        >
          {ru.home.start}
        </button>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="min-h-10 rounded-surface px-1 text-ui text-text-dim transition-colors duration-[120ms] hover:text-text"
        >
          {ru.home.pickFile}
        </button>
        <button
          type="button"
          onClick={() => begin(SAMPLE_TEXT, ru.home.sampleTitle)}
          className="min-h-10 rounded-surface px-1 text-ui text-text-dim transition-colors duration-[120ms] hover:text-text"
        >
          {ru.home.trySample}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".txt,.md,.docx"
          tabIndex={-1}
          className="sr-only"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            void importFirst(files);
          }}
        />
      </div>

      <p className="mt-1 text-meta text-text-dim">{ru.home.dropHint}</p>
      {error && (
        <p role="alert" className="mt-3 text-ui text-danger">
          {ERROR_TEXT[error]}
        </p>
      )}

      {docs.length > 0 && (
        <section aria-labelledby="home-docs" className="mt-14">
          <h2 id="home-docs" className="mb-1 text-ui font-medium text-text-dim">
            {ru.home.yourTexts}
          </h2>
          <ul className="border-t border-line">
            {docs.map((doc) => (
              <DocRow
                key={doc.id}
                doc={doc}
                now={now}
                onOpen={(d, screen) => useApp.getState().openDocument(d.id, screen)}
                onRename={(d, title) => useApp.getState().renameDoc(d.id, title)}
                onDelete={(d) => void useApp.getState().deleteDoc(d.id)}
              />
            ))}
          </ul>
        </section>
      )}

      <BackupBar />
    </main>
  );
}
