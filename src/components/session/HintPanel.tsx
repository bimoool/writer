import type { CSSProperties, ReactNode } from 'react';
import { ru } from '../../i18n/ru';
import { PLATE_EM, skeletonParts, type HintLevel, type SkeletonMode, type SkeletonPart } from '../../lib/hints';
import type { Lang } from '../../lib/tokens';
import type { Keyphrase } from '../../lib/types';

const order = (i: number) => ({ '--i': i }) as CSSProperties;
const plate = (length: number) => <span className="plate" style={{ width: `${Math.round(length * PLATE_EM * 100) / 100}em` }} />;

/** Ступень 1. Ключевые фразы блока маркером, как в тексте, а не карточками (DESIGN §6.2). Порядок как в исходнике. */
export function ThemeChips({ text, phrases }: { text: string; phrases: Keyphrase[] }) {
  if (phrases.length === 0) return null;
  return (
    <ul aria-label={ru.session.hints.topics} className="reading-column m-0 flex max-w-none list-none flex-wrap gap-x-4 gap-y-1 p-0 text-text">
      {phrases.map((p, i) => (
        <li key={p.start} className="marker-chip" data-reveal="in" style={order(i)}>
          {text.slice(p.start, p.end)}
        </li>
      ))}
    </ul>
  );
}

/**
 * Плашка или буква с плашкой вместе со знаками препинания, которые к ним прилегают: без этого строка могла бы
 * перенестись между плашкой и запятой.
 */
function glue(parts: SkeletonPart[]): ReactNode[] {
  const nodes: ReactNode[] = [];
  const copy = parts.map((p) => ({ ...p }));
  copy.forEach((part, i) => {
    if (part.kind === 'text') {
      if (part.text) nodes.push(part.text);
      return;
    }
    if (part.kind === 'phrase') {
      nodes.push(
        <span key={i} className="marker-chip" data-reveal="in" style={order(part.index)}>
          {part.text}
        </span>,
      );
      return;
    }
    // Хвост предыдущего текста без пробелов уже выведен; забираем начало следующего до первого пробела.
    const next = copy[i + 1];
    let tail = '';
    if (next?.kind === 'text') {
      tail = /^\S+/.exec(next.text)?.[0] ?? '';
      next.text = next.text.slice(tail.length);
    }
    nodes.push(
      <span key={i} className="whitespace-nowrap">
        {part.kind === 'letter' ? (
          <>
            <span className="text-text-dim">{part.letter}</span>
            {part.rest > 0 && plate(part.rest)}
          </>
        ) : (
          plate(part.length)
        )}
        {tail}
      </span>,
    );
  });
  return nodes;
}

/**
 * Ступени 2 и 3. Исходный блок, где видны только ключевые фразы, а остальные слова превращены в плашки
 * (ступень 3: первая буква и плашка). Слов вне фраз в разметке нет совсем, только длины.
 * Для скринридера скелет скрыт (aria-hidden), а список ключевых фраз отдаётся отдельно.
 */
export function Skeleton({ text, phrases, mode, lang }: { text: string; phrases: Keyphrase[]; mode: SkeletonMode; lang?: Lang }) {
  return (
    <div aria-hidden="true" data-skeleton={mode} className="reading-column max-w-none text-text">
      {glue(skeletonParts(text, phrases, mode, lang))}
    </div>
  );
}

/** Список ключевых фраз только для скринридера. */
export function PhraseList({ text, phrases }: { text: string; phrases: Keyphrase[] }) {
  return (
    <ul className="sr-only" aria-label={ru.session.hints.phrases}>
      {phrases.map((p) => (
        <li key={p.start}>{text.slice(p.start, p.end)}</li>
      ))}
    </ul>
  );
}

interface PanelProps {
  text: string;
  phrases: Keyphrase[];
  lang: Lang;
  open: Record<HintLevel, boolean>;
}

/** Открытые ступени 1–3. Если открыты и скелет, и первые буквы, показываются первые буквы (раскрывают больше). */
export function HintPanel({ text, phrases, lang, open }: PanelProps) {
  const mode: SkeletonMode | null = open[3] ? 'letters' : open[2] ? 'skeleton' : null;
  if (!open[1] && !mode) return null;
  return (
    <div data-hint-panel className="space-y-3">
      {open[1] && <ThemeChips text={text} phrases={phrases} />}
      {mode && <Skeleton text={text} phrases={phrases} mode={mode} lang={lang} />}
      {mode && !open[1] && <PhraseList text={text} phrases={phrases} />}
    </div>
  );
}
