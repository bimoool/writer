import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { canShareFile, downloadBlob, shareFile } from '../components/download';
import { CheckPanel } from '../components/check/CheckPanel';
import { FindingCard } from '../components/check/FindingCard';
import { useTextCheck } from '../components/check/useTextCheck';
import { CompareTable, CompareTabs, type Marks, type Side } from '../components/result/Compare';
import { useResultEdit } from '../components/result/useResultEdit';
import { useMediaQuery } from '../components/useMediaQuery';
import { ru } from '../i18n/ru';
import { computeMetrics, toPercent } from '../lib/metrics';
import { frontierIndex } from '../lib/session';
import { detectLang } from '../lib/tokens';
import { assembleText, type ExportFormat } from '../lib/io/export';
import { makeExportFile } from '../lib/io/exportFile';
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

type Notice = 'copied' | 'copyFailed' | 'exportFailed' | 'glvrdCopied' | 'glvrdFailed' | null;

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

/** Главная метрика: число крупно, подпись над ним, пояснение под ним. */
function MainMetric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <dl>
      <dt className="text-meta text-text-dim">{label}</dt>
      <dd className="font-serif text-h1 tabular-nums text-text">{value}</dd>
      <dd className="max-w-[20rem] text-meta text-text-dim">{note}</dd>
    </dl>
  );
}

/** Второстепенный показатель в общем ряду: подпись и значение одной строкой. */
function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5">
      <dt className="text-meta text-text-dim">{label}</dt>
      <dd className="text-ui tabular-nums text-text">
        {value}
        {note && <span className="ml-1.5 text-meta text-text-dim">{note}</span>}
      </dd>
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
    timer.current = setTimeout(() => setNotice(null), next === 'copied' ? 3000 : next === 'glvrdCopied' ? 12000 : 6000);
  };

  const finished = !!doc && frontierIndex(doc) >= doc.blocks.length;
  useEffect(() => {
    if (!doc) useApp.getState().go('home');
    else if (!finished) useApp.getState().go('session');
  }, [doc, finished]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const settings = useApp((s) => s.settings);
  const lang = useMemo(() => (doc ? detectLang(doc.source) : 'ru'), [doc]);
  // Режим правки (SPEC §15.5): пока он включён, метрики и проверка считаются по снимку на входе в режим.
  const editButton = useRef<HTMLButtonElement>(null);
  const edit = useResultEdit(doc, settings.allowPaste, lang, () => requestAnimationFrame(() => editButton.current?.focus()));
  const base = edit.frozen ?? doc;

  // Проверка текста (SPEC §15): до нажатия «Проверить текст» ничего не считается.
  const check = useTextCheck(base);
  const [side, setSide] = useState<Side>('yours');
  const returnFocus = useRef<HTMLElement | null>(null);
  const openFinding = (id: string | null) => {
    if (id) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setSide('yours');
      requestAnimationFrame(() => document.querySelector(`[data-finding~="${id}"]`)?.scrollIntoView({ block: 'center' }));
    }
    check.open(id);
  };
  const closeFinding = () => {
    check.open(null);
    const back = returnFocus.current;
    // Кнопка могла исчезнуть (подсветка выключена или слово заменено): тогда фокус на панель проверки.
    requestAnimationFrame(() => (back?.isConnected ? back : document.querySelector<HTMLElement>('[data-check-panel]'))?.focus());
  };
  const allFindings = [...check.findings.read, ...check.findings.ai, ...check.findings.cmp];
  const active = check.activeId ? allFindings.find((f) => f.id === check.activeId) : undefined;
  const view = { ...check, open: openFinding };
  const marks: Marks | undefined =
    check.started && check.highlight && check.ct && !edit.on
      ? {
          parts: check.ct.parts,
          findings: check.findings[check.tab],
          activeId: check.activeId,
          badges: check.tab === 'cmp' && check.compare ? new Map(check.compare.topBlocks.map((b) => [b.blockId, b.count])) : undefined,
          open: openFinding,
        }
      : undefined;

  const metrics = useMemo(() => (base ? computeMetrics(base.blocks, lang) : null), [base, lang]);
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
    if (!doc || !finished || edit.on) return;
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
  }, [fileKey, edit.on]);

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

  // Мостик к Главреду: приложение само ничего не отправляет. Текст копируется в буфер, ссылка открывается обычным переходом.
  const copyForGlvrd = async () => flash((await copyText(text)) ? 'glvrdCopied' : 'glvrdFailed');

  const share = async () => {
    if (ready && (await shareFile(ready)) === 'failed') flash('exportFailed');
  };

  const ownWords = toPercent(metrics.ownWords);
  const typed = toPercent(metrics.typedShare);
  const notices = {
    copied: ru.result.copied,
    copyFailed: ru.result.copyFailed,
    exportFailed: ru.result.exportFailed,
    glvrdCopied: ru.check.glvrd.copied,
    glvrdFailed: ru.check.glvrd.copyFailed,
  };

  return (
    <main className="mx-auto w-full max-w-[72rem] px-4 pb-20 pt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h1 className="font-serif text-h1 text-text">{ru.result.title}</h1>
        <button type="button" className={`${quiet} -mr-3`} onClick={() => useApp.getState().openDocument(null, 'home')}>
          {ru.result.home}
        </button>
      </div>
      <p className="mt-1 text-ui text-text-dim">{ru.result.summary(doc.blocks.length)}</p>

      <section aria-label={ru.result.metrics} className="mt-8">
        <MainMetric
          label={ru.result.ownWords}
          value={ownWords === null ? ru.result.none : ru.result.percent(ownWords)}
          note={ownWords === null ? ru.result.ownWordsTooShort : ru.result.ownWordsNote}
        />
        <dl className="mt-5 flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-4">
          <Stat label={ru.result.time} value={ru.duration(metrics.activeMs)} />
          <Stat label={ru.result.words} value={String(metrics.wordsWritten)} />
          <Stat label={ru.result.hintsLabel} value={ru.result.hintsValue(metrics.opens[1], metrics.opens[2], metrics.opens[3])} />
          <Stat label={ru.result.peeks} value={String(metrics.peeks)} />
          <Stat
            label={ru.result.typedShare}
            value={typed === null ? ru.result.none : ru.result.percent(typed)}
            note={typed === null ? ru.result.typedShareNone : undefined}
          />
        </dl>
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
          <a
            href="https://glvrd.ru"
            target="_blank"
            rel="noopener noreferrer"
            className={`${secondary} inline-flex items-center`}
            onClick={() => void copyForGlvrd()}
          >
            {ru.check.glvrd.open}
          </a>
        </div>
        <p className="mt-2 max-w-[32rem] text-meta text-text-dim">{ru.check.glvrd.note}</p>
        <p role="status" className="mt-1 min-h-5 text-meta text-text-dim">
          {notice ? notices[notice] : ''}
        </p>
      </section>

      <section aria-label={ru.check.title} className="mt-10">
        <div className="flex flex-wrap items-center gap-2">
          {!check.started && (
            <button type="button" className={secondary} disabled={edit.on} onClick={check.start}>
              {ru.check.run}
            </button>
          )}
          <button ref={editButton} type="button" className={edit.on ? primary : secondary} aria-pressed={edit.on} onClick={edit.on ? edit.finish : edit.start}>
            {edit.on ? ru.edit.done : ru.edit.start}
          </button>
        </div>
        <p className="mt-2 max-w-[32rem] text-meta text-text-dim">{ru.edit.note}</p>
        {!check.started && <p className="mt-1 max-w-[32rem] text-meta text-text-dim">{ru.check.runNote}</p>}
        <p role="status" className="mt-1 min-h-5 max-w-[32rem] text-meta text-text-dim">
          {edit.on ? (edit.api?.activeId ? '' : ru.edit.pick) : edit.restored ? ru.edit.restored : ''}
        </p>
        {edit.on && check.started && <p className="max-w-[32rem] text-meta text-text-dim">{ru.edit.paused}</p>}
      </section>

      {!edit.on && <CheckPanel check={view} />}

      <section aria-label={ru.result.compare} className="mt-10">
        {wide ? <CompareTable blocks={doc.blocks} marks={marks} edit={edit.api} /> : <CompareTabs blocks={doc.blocks} marks={marks} edit={edit.api} side={side} setSide={setSide} />}
      </section>
      {active && <FindingCard check={view} finding={active} onClose={closeFinding} />}
    </main>
  );
}
