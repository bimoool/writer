import { useEffect, useRef } from 'react';
import { ru } from '../../i18n/ru';
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

  const title =
    finding.kind === 'read'
      ? finding.sub === 'long'
        ? ru.check.read.longSentence(finding.words)
        : ru.check.read.repeat(finding.word, finding.count, finding.span)
      : finding.detail?.dashes
        ? ru.check.patterns.dashes(finding.detail.dashes, finding.detail.sentences ?? 0)
        : finding.detail?.run
          ? ru.check.patterns.even(finding.detail.run)
          : (check.ct?.text.slice(finding.start, finding.end) ?? '');
  const body = finding.kind === 'ai' ? finding.hint : finding.kind === 'read' && finding.sub === 'repeat' ? ru.check.read.repeatHint : '';

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
      {finding.kind === 'ai' && <p className="mt-2 text-meta text-text-dim">{ru.check.patterns.note}</p>}
    </div>
  );
}
