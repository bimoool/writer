import { useMemo, useState } from 'react';
import { findPatterns } from '../../lib/aiCheck';
import { buildCheckText, type CheckText } from '../../lib/checkText';
import { aiFindings, readFindings, type Finding, type FindingKind } from '../../lib/findings';
import { analyzeReadability, type Readability } from '../../lib/readability';
import type { Doc } from '../../lib/types';

export interface TextCheck {
  started: boolean;
  start(): void;
  ct: CheckText | null;
  tab: FindingKind;
  setTab(tab: FindingKind): void;
  highlight: boolean;
  setHighlight(on: boolean): void;
  readability: Readability | null;
  findings: Record<FindingKind, Finding[]>;
  /** Открытая находка (карточка с пояснением). */
  activeId: string | null;
  open(id: string | null): void;
}

const EMPTY: Record<FindingKind, Finding[]> = { read: [], ai: [] };

/**
 * Состояние проверки текста на экране Result (SPEC §15). Пока не нажата «Проверить текст», ничего не считается.
 * Проверка только читает документ.
 */
export function useTextCheck(doc: Doc | undefined): TextCheck {
  const [started, setStarted] = useState(false);
  const [tab, setTab] = useState<FindingKind>('read');
  const [highlight, setHighlight] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);

  const ct = useMemo(() => (started && doc ? buildCheckText(doc.blocks) : null), [started, doc]);
  const readability = useMemo(() => (ct ? analyzeReadability(ct) : null), [ct]);
  const patterns = useMemo(() => (ct ? aiFindings(findPatterns(ct)) : []), [ct]);
  const findings = useMemo(
    () => (ct ? { read: readability ? readFindings(readability) : [], ai: patterns } : EMPTY),
    [ct, readability, patterns],
  );

  return {
    started,
    start: () => setStarted(true),
    ct,
    tab,
    setTab,
    highlight,
    setHighlight,
    readability,
    findings,
    activeId,
    open: setActiveId,
  };
}
