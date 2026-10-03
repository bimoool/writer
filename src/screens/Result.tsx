import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { canShareFile, downloadBlob, shareFile } from '../components/download';
import { useMediaQuery } from '../components/useMediaQuery';
import { ru } from '../i18n/ru';
import { computeMetrics, toPercent } from '../lib/metrics';
import { frontierIndex } from '../lib/session';
import { detectLang } from '../lib/tokens';
import { assembleText, type ExportFormat } from '../lib/io/export';
import { makeExportFile } from '../lib/io/exportFile';
import type { Block } from '../lib/types';
import { useApp } from '../store/app';

const primary =
  'min-h-12 rounded-surface bg-ink px-6 text-ui font-medium text-bg transition-colors duration-[120ms] hover:bg-ink-hover disabled:opacity-60';
const secondary =
  'min-h-12 rounded-surface border border-line px-4 text-ui text-text transition-colors duration-[120ms] hover:border-ink disabled:opacity-60';
const quiet =
  'min-h-12 rounded-surface px-3 text-ui text-text-dim transition-colors duration-[120ms] hover:text-text disabled:opacity-60';

const FORMATS: ExportFormat[] = ['docx', 'md', 'txt'];
/** Уже этой ширины колонки не помещаются, вместо них вкладки (SPEC §9). */
const WIDE = '(min-width: 700px)';

type Side = 'source' | 'yours';
type Notice = 'copied' | 'copyFailed' | 'exportFailed' | null;

/** Копирование. Clipboard API есть только в защищённом контексте (https), на обычном http работает запасной путь. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
    document.body.append(el);
    el.select();
    const ok = document.execCommand('copy');
    el.remove();
    return ok;
  }
}

/** Текст блока с учётом вида: заголовок выделен, пункт списка с маркером. */
function BlockText({ block, side }: { block: Block; side: Side }) {
  const text = (side === 'source' ? block.sourceText : block.userText).trim();
  const kind = block.kind === 'heading' ? 'font-semibold' : block.kind === 'list-item' ? 'list-bullet' : '';
  return <p className={`whitespace-pre-wrap [overflow-wrap:anywhere] ${kind} ${text ? '' : 'text-text-ghost'}`}>{text || ru.result.none}</p>;
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-meta text-text-dim">{label}</dt>
      <dd className="font-serif text-h2 tabular-nums text-text">{value}</dd>
      {note && <dd className="max-w-[16rem] text-meta text-text-dim">{note}</dd>}
    </div>
  );
}

/** Сравнение на широком экране: таблица, строка на блок, так что блоки исходника и пересказа стоят друг напротив друга. */
function CompareTable({ blocks }: { blocks: Block[] }) {
  return (
    <table className="reading-column w-full max-w-none table-fixed border-collapse text-left">
      <thead>
        <tr>
          <th scope="col" className="pb-2 pr-6 font-sans text-meta font-normal text-text-dim">
            {ru.result.source}
          </th>
          <th scope="col" className="pb-2 pl-6 font-sans text-meta font-normal text-text-dim">
            {ru.result.yours}
          </th>
        </tr>
      </thead>
      <tbody>
        {blocks.map((b) => (
          <tr key={b.id} className="border-t border-line align-top">
            <td className="py-3 pr-6 text-text-dim">
              <BlockText block={b} side="source" />
            </td>
            <td className="border-l border-line py-3 pl-6 text-text">
              <BlockText block={b} side="yours" />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Сравнение на узком экране: две вкладки, стрелки влево и вправо переключают их (шаблон WAI-ARIA Tabs). */
function CompareTabs({ blocks }: { blocks: Block[] }) {
  const id = useId();
  const [side, setSide] = useState<Side>('yours');
  const tabs = useRef<Record<Side, HTMLButtonElement | null>>({ source: null, yours: null });
  const sides: Side[] = ['source', 'yours'];

  const onKey = (e: KeyboardEvent) => {
    const next: Side | null =
      e.key === 'ArrowLeft' || e.key === 'Home' ? 'source' : e.key === 'ArrowRight' || e.key === 'End' ? 'yours' : null;
    if (!next) return;
    e.preventDefault();
    setSide(next);
    tabs.current[next]?.focus();
  };

  return (
    <div>
      <div role="tablist" aria-label={ru.result.compare} className="-ml-3 flex gap-1 border-b border-line" onKeyDown={onKey}>
        {sides.map((s) => (
          <button
            key={s}
            ref={(el) => {
              tabs.current[s] = el;
            }}
            type="button"
            role="tab"
            id={`${id}-${s}-tab`}
            aria-selected={side === s}
            aria-controls={`${id}-${s}-panel`}
            tabIndex={side === s ? 0 : -1}
            onClick={() => setSide(s)}
            className={`-mb-px min-h-12 border-b-2 px-3 text-ui transition-colors duration-[120ms] ${
              side === s ? 'border-ink text-text' : 'border-transparent text-text-dim hover:text-text'
            }`}
          >
            {s === 'source' ? ru.result.source : ru.result.yours}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-${side}-panel`} aria-labelledby={`${id}-${side}-tab`} tabIndex={0} className="reading-column max-w-none">
        {blocks.map((b) => (
          <div key={b.id} className={`border-b border-line py-3 ${side === 'source' ? 'text-text-dim' : 'text-text'}`}>
            <BlockText block={b} side={side} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Итог (SPEC §9, DESIGN §5 Result): метрики, сохранение текста и сравнение с исходником. */
export function Result() {
  const doc = useApp((s) => s.docs.find((d) => d.id === s.currentDocId));
  const id = useId();
  const wide = useMediaQuery(WIDE);
  const [notice, setNotice] = useState<Notice>(null);
  const [format, setFormat] = useState<ExportFormat>('docx');
  const [withSource, setWithSource] = useState(false);
  const [prepared, setPrepared] = useState<{ key: string; file: File } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flash = (next: Notice) => {
    clearTimeout(timer.current);
    setNotice(next);
    timer.current = setTimeout(() => setNotice(null), next === 'copied' ? 3000 : 6000);
  };

  const finished = !!doc && frontierIndex(doc) >= doc.blocks.length;
  useEffect(() => {
    if (!doc) useApp.getState().go('home');
    else if (!finished) useApp.getState().go('session');
  }, [doc, finished]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const lang = useMemo(() => (doc ? detectLang(doc.source) : 'ru'), [doc]);
  const metrics = useMemo(() => (doc ? computeMetrics(doc.blocks, lang) : null), [doc, lang]);
  const text = useMemo(() => (doc ? assembleText(doc.blocks) : ''), [doc]);

  // «Вместе с исходником» есть только у .md.
  const sourceIncluded = format === 'md' && withSource;
  const fileKey = `${doc?.id}:${doc?.updatedAt}:${format}:${sourceIncluded}`;
  const exportOptions = useMemo(
    () => ({ withSource: sourceIncluded, sourceHeading: ru.result.source, language: lang === 'ru' ? 'ru-RU' : 'en-US' }),
    [sourceIncluded, lang],
  );

  // Файл собирается заранее, при выборе формата: «Поделиться» должно вызываться прямо в обработчике нажатия,
  // иначе Safari сочтёт его вызванным без жеста пользователя и откажет.
  useEffect(() => {
    if (!doc || !finished) return;
    let alive = true;
    makeExportFile(doc, format, exportOptions).then(
      (file) => alive && setPrepared({ key: fileKey, file }),
      () => alive && flash('exportFailed'),
    );
    return () => {
      alive = false;
    };
    // flash читает только ref и setState
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileKey]);

  if (!doc || !finished || !metrics) return null;

  const ready = prepared?.key === fileKey ? prepared.file : null;
  const shareable = !!ready && canShareFile(ready);

  const copy = async () => flash((await copyText(text)) ? 'copied' : 'copyFailed');

  const download = async () => {
    if (!doc) return;
    try {
      const file = ready ?? (await makeExportFile(doc, format, exportOptions));
      downloadBlob(file.name, file);
    } catch {
      flash('exportFailed');
    }
  };

  const share = async () => {
    if (ready && (await shareFile(ready)) === 'failed') flash('exportFailed');
  };

  const ownWords = toPercent(metrics.ownWords);
  const typed = toPercent(metrics.typedShare);
  const notices = { copied: ru.result.copied, copyFailed: ru.result.copyFailed, exportFailed: ru.result.exportFailed };

  return (
    <main className="mx-auto w-full max-w-[72rem] px-4 pb-20 pt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h1 className="font-serif text-h1 text-text">{ru.result.title}</h1>
        <button type="button" className={`${quiet} -mr-3`} onClick={() => useApp.getState().openDocument(null, 'home')}>
          {ru.result.home}
        </button>
      </div>
      <p className="mt-1 text-ui text-text-dim">{ru.result.summary(doc.blocks.length, metrics.activeMs)}</p>

      <section aria-label={ru.result.metrics} className="mt-8">
        <dl className="flex flex-wrap gap-x-10 gap-y-5">
          <Metric
            label={ru.result.ownWords}
            value={ownWords === null ? ru.result.none : ru.result.percent(ownWords)}
            note={ownWords === null ? ru.result.ownWordsTooShort : ru.result.ownWordsNote}
          />
          <Metric
            label={ru.result.typedShare}
            value={typed === null ? ru.result.none : ru.result.percent(typed)}
            note={typed === null ? ru.result.typedShareNone : undefined}
          />
          <Metric label={ru.result.words} value={String(metrics.wordsWritten)} />
          <Metric label={ru.result.peeks} value={String(metrics.peeks)} />
        </dl>
        <p className="mt-4 text-ui text-text-dim">{ru.result.hints(metrics.opens[1], metrics.opens[2], metrics.opens[3])}</p>
      </section>

      <section aria-labelledby={`${id}-export`} className="mt-10">
        <h2 id={`${id}-export`} className="sr-only">
          {ru.result.export}
        </h2>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <button type="button" className={primary} onClick={() => void copy()}>
            {ru.result.copy}
          </button>
          <fieldset className="flex items-center gap-1">
            <legend className="sr-only">{ru.result.format}</legend>
            {FORMATS.map((f) => (
              <label
                key={f}
                className="flex min-h-10 cursor-pointer items-center rounded-surface px-3 text-ui text-text-dim transition-colors duration-[120ms] hover:text-text has-[:checked]:bg-surface has-[:checked]:text-text has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink"
              >
                <input
                  type="radio"
                  name={`${id}-format`}
                  value={f}
                  checked={format === f}
                  onChange={() => setFormat(f)}
                  className="sr-only"
                />
                {ru.result.ext(f)}
              </label>
            ))}
          </fieldset>
        </div>

        {format === 'md' && (
          <label className="mt-3 flex min-h-10 w-fit cursor-pointer items-center gap-2 text-ui text-text">
            <input
              type="checkbox"
              checked={withSource}
              onChange={(e) => setWithSource(e.target.checked)}
              aria-describedby={`${id}-with-source`}
              className="size-4 accent-ink"
            />
            {ru.result.withSource}
          </label>
        )}
        {format === 'md' && (
          <p id={`${id}-with-source`} className="pl-6 text-meta text-text-dim">
            {ru.result.withSourceNote}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className={secondary} onClick={() => void download()}>
            {ru.result.download(format)}
          </button>
          {shareable && (
            <button type="button" className={secondary} onClick={() => void share()}>
              {ru.result.share}
            </button>
          )}
        </div>
        <p role="status" className="mt-1 min-h-5 text-meta text-text-dim">
          {notice ? notices[notice] : ''}
        </p>
      </section>

      <section aria-label={ru.result.compare} className="mt-10">
        {wide ? <CompareTable blocks={doc.blocks} /> : <CompareTabs blocks={doc.blocks} />}
      </section>
    </main>
  );
}
