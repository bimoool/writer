import { Fragment, useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { ru } from '../../i18n/ru';
import type { CheckPart } from '../../lib/checkText';
import { FIELD_NAMES } from '../../lib/fieldAttrs';
import { markSegments, type Finding } from '../../lib/findings';
import type { Block } from '../../lib/types';
import { WritingField, type FieldCounts } from '../session/WritingField';

export type Side = 'source' | 'yours';

/** Режим правки на Result (SPEC §15.5): одна ячейка «Твой текст» за раз превращается в поле. */
export interface EditApi {
  activeId: string | null;
  draft: string;
  lang: string;
  allowPaste: boolean;
  message: 'empty' | 'paste' | null;
  pick(id: string): void;
  change(value: string, counts: FieldCounts): void;
  pasteBlocked(): void;
}

/** Подсветка проверки в колонке «Твой текст» (SPEC §15.4). */
export interface Marks {
  parts: CheckPart[];
  findings: Finding[];
  /** Те же находки, разложенные по блокам (bucketFindings). */
  byBlock: Map<string, Finding[]>;
  activeId: string | null;
  /** Блоки с наибольшим числом перенесённых из исходника фраз: id блока → число (вкладка «Сравнение»). */
  badges?: Map<string, number>;
  open(id: string): void;
}

/** Текст блока с учётом вида: заголовок выделен, пункт списка с маркером. */
export function BlockText({ block, side, marks }: { block: Block; side: Side; marks?: Marks }) {
  const text = (side === 'source' ? block.sourceText : block.userText).trim();
  const kind = block.kind === 'heading' ? 'font-semibold' : block.kind === 'list-item' ? 'list-bullet' : '';
  const part = side === 'yours' && marks ? marks.parts.find((p) => p.blockId === block.id) : undefined;
  const own = (marks?.byBlock.get(block.id)) ?? [];
  const segments = part ? markSegments(part, own) : [];
  const byId = new Map(own.map((f) => [f.id, f]));
  let content: ReactNode = text || ru.result.none;
  if (segments.length) {
    const nodes: ReactNode[] = [];
    let at = 0;
    for (const seg of segments) {
      if (seg.start > at) nodes.push(text.slice(at, seg.start));
      nodes.push(
        // Не <button>: кнопка всегда рисуется цельным блоком и длинная подсветка не переносилась бы по строкам.
        <span
          key={seg.start}
          role="button"
          tabIndex={0}
          className={`mark mark-${byId.get(seg.ids[0]!)?.tone ?? 'ai'}`}
          data-finding={seg.ids.join(' ')}
          aria-haspopup="dialog"
          aria-expanded={seg.ids.includes(marks!.activeId ?? '')}
          onClick={() => marks!.open(seg.ids[0]!)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              marks!.open(seg.ids[0]!);
            }
          }}
        >
          {text.slice(seg.start, seg.end)}
        </span>,
      );
      at = seg.end;
    }
    if (at < text.length) nodes.push(text.slice(at));
    content = nodes.map((n, i) => <Fragment key={i}>{n}</Fragment>);
  }
  return <p className={`whitespace-pre-wrap [overflow-wrap:anywhere] ${kind} ${text ? '' : 'text-text-ghost'}`}>{content}</p>;
}



function EditField({ number, edit }: { number: number; edit: EditApi }) {
  const field = useRef<HTMLTextAreaElement>(null);
  // Страница прокручивается целиком, своей прокручиваемой области у поля нет.
  const noScroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const ta = field.current;
    if (!ta) return;
    ta.focus({ preventScroll: false });
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }, []);
  return (
    <div className="rounded-surface bg-surface px-3 pt-3">
      <WritingField
        fieldRef={field}
        scrollRef={noScroller}
        value={edit.draft}
        blocked={false}
        allowPaste={edit.allowPaste}
        lang={edit.lang}
        mono={false}
        label={ru.edit.fieldLabel(number)}
        name={FIELD_NAMES.resultEdit}
        onChange={edit.change}
        onPasteBlocked={edit.pasteBlocked}
      />
      {edit.message && (
        <p role="status" className="mt-2 font-sans text-meta text-text-dim">
          {edit.message === 'empty' ? ru.edit.empty : ru.session.pasteOff}
        </p>
      )}
    </div>
  );
}

/** Ячейка «Твой текст»: обычный текст, в режиме правки нажимаемый блок, а выбранный блок поле ввода. */
function YourCell({ block, number, marks, edit }: { block: Block; number: number; marks?: Marks; edit?: EditApi }) {
  const badge = marks?.badges?.get(block.id);
  if (!edit)
    return (
      <>
        {badge ? <p className="mb-1 font-sans text-meta text-text-dim"><span className="badge-carry">{ru.check.compare.blockBadge(badge)}</span></p> : null}
        <BlockText block={block} side="yours" marks={marks} />
      </>
    );
  if (edit.activeId === block.id) return <EditField number={number} edit={edit} />;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={ru.edit.editBlock(number)}
      className="edit-cell cursor-text rounded-surface"
      onClick={() => edit.pick(block.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          edit.pick(block.id);
        }
      }}
    >
      <BlockText block={block} side="yours" />
    </div>
  );
}

/** Сравнение на широком экране: таблица, строка на блок, так что блоки исходника и пересказа стоят друг напротив друга. */
export function CompareTable({ blocks, marks, edit }: { blocks: Block[]; marks?: Marks; edit?: EditApi }) {
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
        {blocks.map((b, i) => (
          <tr key={b.id} className="border-t border-line align-top">
            <td className="py-3 pr-6 text-text-dim">
              <BlockText block={b} side="source" />
            </td>
            <td className="border-l border-line py-3 pl-6 text-text">
              <YourCell block={b} number={i + 1} marks={marks} edit={edit} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Сравнение на узком экране: две вкладки, стрелки влево и вправо переключают их (шаблон WAI-ARIA Tabs). */
export function CompareTabs({ blocks, marks, edit, side, setSide }: { blocks: Block[]; marks?: Marks; edit?: EditApi; side: Side; setSide: (s: Side) => void }) {
  const id = useId();
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
        {blocks.map((b, i) => (
          <div key={b.id} className={`border-b border-line py-3 ${side === 'source' ? 'text-text-dim' : 'text-text'}`}>
            {side === 'yours' ? <YourCell block={b} number={i + 1} marks={marks} edit={edit} /> : <BlockText block={b} side="source" />}
          </div>
        ))}
      </div>
    </div>
  );
}

