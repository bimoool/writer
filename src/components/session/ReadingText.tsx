import type { RefObject } from 'react';
import type { BlockKind } from '../../lib/types';

interface Props {
  text: string;
  kind: BlockKind;
  innerRef: RefObject<HTMLDivElement>;
}

/** Блок для чтения. Каждое слово в своём элементе, чтобы растворяться по отдельности. */
export function ReadingText({ text, kind, innerRef }: Props) {
  return (
    <div
      ref={innerRef}
      data-reading-text
      className={`reading-column max-w-none text-text ${kind === 'heading' ? 'font-medium' : ''}`}
    >
      {kind === 'list-item' && (
        <span aria-hidden="true" className="mr-2 text-text-ghost">
          –
        </span>
      )}
      {text.split(/(\s+)/).map((part, i) =>
        /^\s+$/.test(part) || part === '' ? (
          part
        ) : (
          <span key={i} data-w className="read-word">
            {part}
          </span>
        ),
      )}
    </div>
  );
}
