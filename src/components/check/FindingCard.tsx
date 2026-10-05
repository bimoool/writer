import { useEffect, useRef } from 'react';
import { ru } from '../../i18n/ru';
import type { SourceSpot } from '../../lib/compare';
import type { Finding } from '../../lib/findings';
import type { TextCheck } from './useTextCheck';

/**
 * Пояснение к найденному месту. Закреплено внизу экрана (на телефоне это нижняя панель, на широком экране карточка),
 * чтобы не считать положение рядом с текстом. Фокус уходит в карточку, Esc и «Закрыть» возвращают его назад.
 */
export function FindingCard({ check, finding, onClose }: { check: TextCheck; finding: Finding; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [finding.id]);

  const quote = check.ct?.text.slice(finding.start, finding.end) ?? '';
  let title = quote;
  let body = '';
  let extra: string | undefined;
  let source: SourceSpot | undefined;
  switch (finding.kind) {
    case 'read':
      title = finding.sub === 'long' ? ru.check.read.longSentence(finding.words) : ru.check.read.repeat(finding.word, finding.count, finding.span);
      body = finding.sub === 'repeat' ? ru.check.read.repeatHint : '';
      break;
    case 'ai':
      switch (finding.sub) {
        case 'rule':
          if (finding.detail?.dashes) title = ru.check.patterns.dashes(finding.detail.dashes, finding.detail.sentences ?? 0);
          body = finding.hint;
          extra = finding.advice ? ru.check.patterns.advice(finding.advice) : undefined;
          break;
        case 'rhythm':
          title = ru.check.patterns.chain(finding.count, finding.words);
          body = ru.check.patterns.chainHint;
          break;
        case 'start':
          title = ru.check.patterns.opening(finding.key, finding.count, finding.scope);
          body = ru.check.patterns.openingHint;
          break;
        case 'diversity':
          title = ru.check.patterns.diversityWindow(Math.round(finding.ratio * 100), Math.round(finding.mean * 100));
          body = ru.check.patterns.diversityHint;
          extra = finding.top.length ? ru.check.patterns.diversityTop(finding.top) : undefined;
          break;
      }
      break;
    case 'cmp':
      if (finding.sub === 'pattern') {
        title = quote;
        body = ru.check.compare.carriedLabel;
        extra = finding.hint;
      } else {
        title = ru.check.compare.phraseWords(finding.words);
        source = finding.source;
      }
      break;
  }
  const soft = finding.kind === 'ai' || (finding.kind === 'cmp' && finding.sub === 'pattern');

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={ru.check.cardLabel}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
      className="fixed inset-x-3 bottom-3 z-30 mx-auto max-h-[60dvh] max-w-md overflow-y-auto rounded-surface border border-line bg-surface p-4 text-ui text-text pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 font-medium [overflow-wrap:anywhere]">{title}</p>
        <button type="button" className="-mr-2 -mt-1 min-h-11 shrink-0 rounded-surface px-2 text-text-dim hover:text-text" onClick={onClose}>
          {ru.check.close}
        </button>
      </div>
      {body && <p className="mt-1 text-text-dim">{body}</p>}
      {extra && <p className="mt-1 text-text-dim">{extra}</p>}
      {source && (
        <div className="mt-2">
          <p className="text-meta text-text-dim">{ru.check.compare.sourceBlock}</p>
          <p className="mt-0.5 font-serif text-text [overflow-wrap:anywhere]">
            {source.text.slice(0, source.start)}
            <span className="mark mark-read">{source.text.slice(source.start, source.end)}</span>
            {source.text.slice(source.end)}
          </p>
        </div>
      )}
      {soft && <p className="mt-2 text-meta text-text-dim">{ru.check.patterns.note}</p>}
    </div>
  );
}
