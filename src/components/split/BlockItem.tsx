import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
import { ru } from '../../i18n/ru';
import { buildSegments, cutGaps, type Segment } from '../../lib/blocks';
import { templatePieces, type TemplateSpot } from '../../lib/sourceTemplates';
import type { Lang } from '../../lib/tokens';
import type { Block, Keyphrase } from '../../lib/types';
import { initialSel, moveForKey, moveSel, selAfter, selRange, wordSpans, type WordSel } from '../../lib/wordSelect';

interface Props {
  block: Block;
  index: number;
  total: number;
  lang: Lang;
  /** До начала работы над текстом блоки можно править. */
  editable: boolean;
  /** Общий режим разреза экрана: во всех блоках показаны все точки разреза. */
  cutMode: boolean;
  /** Правая часть только что сделанного разреза: коротко подсвечивается. */
  flash: boolean;
  /** Сообщение под текстом (например, что выделение пересекается с подсветкой). */
  notice: string | null;
  onRemovePhrase: (phraseIndex: number) => void;
  onMerge: () => void;
  onCut: (offset: number) => void;
  /** Добавляет фразу, выбранную с клавиатуры. Пересечение сообщает сам экран, как при выделении мышью. */
  onAddPhrase: (range: Keyphrase) => 'ok' | 'overlap' | 'empty';
  /** Шаблонные места исходника (в координатах sourceText) для подчёркивания. Пусто, пока переключатель выключен. */
  templates?: TemplateSpot[];
}

/** Кусок текста, у которого есть признак «входит в клавиатурное выделение». */
type Piece = Segment & { selected?: boolean };

/** Режет сегменты по границам выделения; фраза целиком помечается, если выделение её задевает. */
function withSelection(segments: Segment[], range: Keyphrase | null): Piece[] {
  if (!range) return segments;
  return segments.flatMap((seg): Piece[] => {
    const hit = seg.start < range.end && seg.end > range.start;
    if (!hit) return [seg];
    if (seg.kind === 'phrase') return [{ ...seg, selected: true }];
    const a = Math.max(seg.start, range.start);
    const b = Math.min(seg.end, range.end);
    const parts: Piece[] = [];
    if (a > seg.start) parts.push({ kind: 'text', start: seg.start, end: a });
    parts.push({ kind: 'text', start: a, end: b, selected: true });
    if (b < seg.end) parts.push({ kind: 'text', start: b, end: seg.end });
    return parts;
  });
}

/** Сколько первых слов предложения читает скринридер в названии кнопки разреза. */
const CUT_LABEL_WORDS = 6;

const action =
  'min-h-10 rounded-surface px-2 text-meta text-text-dim transition-colors duration-[120ms] hover:text-text';

/**
 * Клик по месту разреза режет сразу только мышью. Касание по тексту разреза не делает: пальцем это случайные
 * срабатывания при прокрутке и выделении, там работает режим «Разрезать». Программный клик (detail 0) тоже не режет.
 */
const isMouseCut = (e: MouseEvent<HTMLElement>) => {
  if (e.detail === 0) return false;
  const type = (e.nativeEvent as PointerEvent).pointerType;
  return type ? type === 'mouse' : window.matchMedia('(hover: hover)').matches;
};

const hasSelection = () => {
  const sel = window.getSelection();
  return !!sel && !sel.isCollapsed;
};

/** Блок разбивки: номер, текст с маркером, счётчик слов и действия. */
export function BlockItem({ block, index, total, lang, editable, cutMode, flash, notice, onRemovePhrase, onMerge, onCut, onAddPhrase, templates }: Props) {
  const item = useRef<HTMLLIElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const keyboardFocus = useRef<number | null>(null);
  // Без IntersectionObserver показываем маркер сразу.
  const [revealed, setRevealed] = useState(() => typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    const el = item.current;
    if (revealed || !el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        setRevealed(true);
        io.disconnect();
      },
      { threshold: 0.1 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [revealed]);

  const { sourceText, keyphrases } = block;
  const gaps = useMemo(() => cutGaps(sourceText, lang, keyphrases), [sourceText, lang, keyphrases]);
  // Почему резать нельзя: в блоке одно предложение или все места разреза внутри подсвеченных фраз.
  const cutBlockedReason = useMemo(
    () => (gaps.length > 0 ? null : cutGaps(sourceText, lang).length === 0 ? ru.split.cutOneSentence : ru.split.cutThroughPhrase),
    [gaps, sourceText, lang],
  );
  // Подпись кнопки разреза: первые слова предложения перед ним. Границы берём без учёта подсветки фраз.
  const cutLabels = useMemo(() => {
    const all = cutGaps(sourceText, lang);
    return new Map(
      all.map((g, i) => {
        const sentence = sourceText.slice(i > 0 ? all[i - 1]!.end : 0, g.start);
        return [g.start, ru.split.cutRowLabel(sentence.split(/\s+/).filter(Boolean).slice(0, CUT_LABEL_WORDS).join(' '))] as const;
      }),
    );
  }, [sourceText, lang]);
  const segments = useMemo(() => buildSegments(sourceText, keyphrases, gaps), [sourceText, keyphrases, gaps]);
  const words = useMemo(() => sourceText.split(/\s+/).filter(Boolean).length, [sourceText]);

  // Режим «Выбрать слова»: выделение по словам с клавиатуры. null — режим выключен.
  // Выбор привязан к тексту, для которого он сделан: после склейки или отмены он сам перестаёт действовать.
  const [pick, setPick] = useState<{ sel: WordSel; text: string; added: string | null } | null>(null);
  const live = pick && pick.text === sourceText ? pick : null;
  const sel = live?.sel ?? null;
  const added = live?.added ?? null;
  const setSel = (next: WordSel | null) => setPick(next && { sel: next, text: sourceText, added: null });
  const spans = useMemo(() => wordSpans(sourceText, lang), [sourceText, lang]);
  const selecting = sel !== null && editable;
  const selRangeNow = selecting && spans[sel.to] ? selRange(spans, { from: Math.min(sel.from, spans.length - 1), to: sel.to }) : null;
  const pieces = useMemo(() => withSelection(selecting ? segments.map((g) => (g.kind === 'gap' ? { kind: 'text' as const, start: g.start, end: g.end } : g)) : segments, selRangeNow), [segments, selecting, selRangeNow]);

  /**
   * Кусок текста с подчёркиванием шаблонных мест. Каждый кусок в своём span с data-o: так выделение мышью
   * (selection.ts) находит смещение и внутри подчёркнутого места. Подчёркивание только оформление.
   */
  const withTemplates = (start: number, end: number) =>
    templates?.length
      ? templatePieces(start, end, templates).map((p) => (
          <span key={p.start} data-o={p.start} className={p.kind ? `tpl-${p.kind}` : undefined}>
            {sourceText.slice(p.start, p.end)}
          </span>
        ))
      : sourceText.slice(start, end);

  const toggleSelect = () => {
    if (selecting) {
      setSel(null);
      return;
    }
    const first = initialSel(spans, keyphrases, sourceText);
    if (!first) return;
    setSel(first);
    // Стрелки слушает блок: фокус на его тексте.
    text.current?.focus();
  };

  const onSelectKey = (e: KeyboardEvent) => {
    if (!selecting || !sel) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setSel(null);
      (item.current?.querySelector('[data-action="select"]') as HTMLElement | null)?.focus();
      return;
    }
    if (e.target !== text.current && e.target !== item.current) return;
    const move = moveForKey(e.key, e.shiftKey);
    if (move) {
      e.preventDefault();
      setSel(moveSel(sel, move, spans.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const range = selRange(spans, sel);
      const result = onAddPhrase(range);
      if (result === 'ok') {
        setPick({ sel: selAfter(spans, range), text: sourceText, added: sourceText.slice(range.start, range.end) });
      }
    }
  };

  // После удаления подсветки с клавиатуры фокус не должен теряться: переходим к соседней фразе или к тексту.
  useEffect(() => {
    const target = keyboardFocus.current;
    if (target === null) return;
    keyboardFocus.current = null;
    const next = target >= 0 ? text.current?.querySelector<HTMLElement>(`[data-phrase="${target}"]`) : null;
    (next ?? text.current)?.focus();
  }, [keyphrases]);

  const removeByKeyboard = (phraseIndex: number) => {
    keyboardFocus.current = Math.min(phraseIndex, keyphrases.length - 2);
    onRemovePhrase(phraseIndex);
  };

  return (
    <li
      ref={item}
      data-block-id={block.id}
      data-flash={flash || undefined}
      aria-label={ru.progress(index + 1, total)}
      className="block-item grid grid-cols-[auto_1fr] gap-x-3 border-b border-line py-5 sm:grid-cols-[2.5rem_minmax(0,1fr)_4rem]"
      onKeyDown={(e) => {
        onSelectKey(e);
      }}
      onBlur={(e) => {
        // Фокус ушёл из блока: режим выбора слов заканчивается.
        if (sel && !e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setSel(null);
        }
      }}
    >
      <span aria-hidden="true" className="col-start-1 row-start-2 pt-1 text-meta tabular-nums text-text-ghost sm:row-start-1 sm:pt-2">
        {index + 1}
      </span>

      <div
        ref={text}
        tabIndex={-1}
        data-block-text
        data-block-id={block.id}
        data-cut-mode={cutMode}
        className={`reading-column col-span-2 row-start-1 max-w-none text-text [overflow-wrap:anywhere] focus:outline-none sm:col-span-1 sm:col-start-2 ${block.kind === 'heading' ? 'font-medium' : ''}`}
      >
        {block.kind === 'list-item' && (
          <span aria-hidden="true" className="mr-2 text-text-ghost">
            –
          </span>
        )}
        {pieces.map((seg) => {
          const slice = sourceText.slice(seg.start, seg.end);
          const picked = 'selected' in seg && seg.selected ? 'word-select' : '';
          if (seg.kind === 'phrase') {
            if (!editable) return <span key={seg.start} data-o={seg.start} className="marker" data-reveal={revealed ? 'in' : 'pending'}>{withTemplates(seg.start, seg.end)}</span>;
            return (
              <span
                key={seg.start}
                data-o={seg.start}
                data-phrase={seg.index}
                role="button"
                tabIndex={0}
                aria-label={ru.split.removePhrase(slice)}
                className={`marker ${picked}`}
                data-reveal={revealed ? 'in' : 'pending'}
                style={{ '--i': seg.index } as CSSProperties}
                onClick={(e) => {
                  // Подсветку убирает только одиночный клик или касание при схлопнутом выделении.
                  // detail > 1 — второй и третий клик двойного и тройного щелчка. detail 0 (активация
                  // вспомогательной технологией) считаем одиночным нажатием.
                  if (e.detail > 1 || hasSelection()) return;
                  onRemovePhrase(seg.index);
                }}
                onKeyDown={(e) => {
                  if (!['Delete', 'Backspace', 'Enter', ' '].includes(e.key)) return;
                  e.preventDefault();
                  removeByKeyboard(seg.index);
                }}
              >
                {withTemplates(seg.start, seg.end)}
              </span>
            );
          }
          if (seg.kind === 'gap' && editable) {
            return cutMode ? (
              <button
                key={seg.start}
                type="button"
                data-o={seg.start}
                className="cut-row"
                aria-label={cutLabels.get(seg.start) ?? ru.split.cutHere}
                onClick={() => onCut(seg.end)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="6" cy="6" r="3" />
                  <circle cx="6" cy="18" r="3" />
                  <path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12" />
                </svg>
                <span aria-hidden="true">{ru.split.cutHere}</span>
              </button>
            ) : (
              <span
                key={seg.start}
                data-o={seg.start}
                aria-hidden="true"
                className="cut-gap"
                onClick={(e) => {
                  if (isMouseCut(e) && !hasSelection()) onCut(seg.end);
                }}
              >
                {withTemplates(seg.start, seg.end)}
              </span>
            );
          }
          return (
            <span key={seg.start} data-o={seg.start} className={picked || undefined}>
              {withTemplates(seg.start, seg.end)}
            </span>
          );
        })}
      </div>

      <span className="col-start-2 row-start-2 pt-1 text-right text-meta tabular-nums text-text-dim sm:col-start-3 sm:row-start-1 sm:pt-2">
        {ru.split.words(words)}
      </span>

      {editable && (
        <div className="col-span-2 row-start-3 mt-1 sm:col-span-1 sm:col-start-2 sm:row-start-2">
          {cutMode && cutBlockedReason && (
            <p data-cut-none className="mb-1 text-meta text-text-dim">
              {cutBlockedReason}
            </p>
          )}
          <div className="block-actions" data-persist={selecting || undefined}>
            {index < total - 1 && (
              <button type="button" data-action="merge" onClick={onMerge} className={action}>
                {ru.split.merge}
              </button>
            )}
            {spans.length > 0 && (
              <button type="button" data-action="select" aria-pressed={selecting} onClick={toggleSelect} className={`${action} ${selecting ? 'bg-surface text-text' : ''}`}>
                {ru.split.selectWords}
              </button>
            )}
          </div>
          {selecting && selRangeNow && (
            <p role="status" className="mt-1 text-meta text-text-dim">
              {added ? ru.split.phraseAdded(added) : ru.split.selectedPhrase(sourceText.slice(selRangeNow.start, selRangeNow.end))}
              <span className="block">{ru.split.selectHint}</span>
            </p>
          )}
          {notice && (
            <p role="status" className="mt-1 text-meta text-danger">
              {notice}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
