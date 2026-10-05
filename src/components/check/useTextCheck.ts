import { useMemo, useState } from 'react';
import { findPatterns } from '../../lib/aiCheck';
import { buildCheckText, buildSourceCheckText, type CheckText } from '../../lib/checkText';
import { compareTexts, type CompareResult } from '../../lib/compare';
import { analyzeDiversity } from '../../lib/diversity';
import {
  compareFindings,
  patternFindings,
  readFindings,
  type Finding,
  type FindingKind,
  type PatternsAnalysis,
} from '../../lib/findings';
import { findOpenings } from '../../lib/openings';
import { analyzeReadability, type Readability } from '../../lib/readability';
import { analyzeRhythm } from '../../lib/rhythm';
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
  patterns: PatternsAnalysis | null;
  compare: CompareResult | null;
  findings: Record<FindingKind, Finding[]>;
  /** Открытая находка (карточка с пояснением). */
  activeId: string | null;
  open(id: string | null): void;
}

const EMPTY: Record<FindingKind, Finding[]> = { read: [], ai: [], cmp: [] };

/** Замер вкладки в Performance API (имена check:read, check:ai, check:cmp): смотреть в DevTools или e2e. */
function timed<T>(name: string, fn: () => T): T {
  const t0 = performance.now();
  const r = fn();
  try {
    performance.measure(`check:${name}`, { start: t0, end: performance.now() });
  } catch {
    /* Performance API недоступен */
  }
  return r;
}

/**
 * Состояние проверки текста на экране Result (SPEC §15). Пока не нажата «Проверить текст», ничего не считается.
 * Каждая вкладка считается один раз, при первом открытии. Проверка только читает документ.
 */
export function useTextCheck(doc: Doc | undefined): TextCheck {
  const [started, setStarted] = useState(false);
  const [tab, setTabState] = useState<FindingKind>('read');
  const [seen, setSeen] = useState<FindingKind[]>(['read']);
  const [highlight, setHighlight] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);

  const setTab = (t: FindingKind) => {
    setTabState(t);
    setSeen((s) => (s.includes(t) ? s : [...s, t]));
  };

  const ct = useMemo(() => (started && doc ? buildCheckText(doc.blocks) : null), [started, doc]);
  const readability = useMemo(() => (ct && seen.includes('read') ? timed('read', () => analyzeReadability(ct)) : null), [ct, seen]);
  const patterns = useMemo<PatternsAnalysis | null>(
    () =>
      ct && seen.includes('ai')
        ? timed('ai', () => ({ rules: findPatterns(ct), rhythm: analyzeRhythm(ct), openings: findOpenings(ct), diversity: analyzeDiversity(ct) }))
        : null,
    [ct, seen],
  );
  const compare = useMemo(
    () => (ct && doc && seen.includes('cmp') ? timed('cmp', () => compareTexts(buildSourceCheckText(doc.blocks), ct)) : null),
    [ct, doc, seen],
  );
  const findings = useMemo(
    () => (ct ? { read: readability ? readFindings(readability) : [], ai: patterns ? patternFindings(patterns) : [], cmp: compare ? compareFindings(compare) : [] } : EMPTY),
    [ct, readability, patterns, compare],
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
    patterns,
    compare,
    findings,
    activeId,
    open: setActiveId,
  };
}
