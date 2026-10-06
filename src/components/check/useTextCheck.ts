import { useEffect, useMemo, useState } from 'react';
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
import { collectUnits } from '../../lib/textUnits';
import type { Doc } from '../../lib/types';

export interface TextCheck {
  started: boolean;
  start(): void;
  /** Все три вкладки посчитаны. Пока нет, панель показывает «Считаем…» (на больших текстах это секунды). */
  ready: boolean;
  ct: CheckText | null;
  tab: FindingKind;
  setTab(tab: FindingKind): void;
  highlight: boolean;
  setHighlight(on: boolean): void;
  readability: Readability | null;
  patterns: PatternsAnalysis | null;
  compare: CompareResult | null;
  /** Слова, предложения и абзацы проверяемого текста: для подписей к пустым результатам. */
  stats: { words: number; sentences: number; paragraphs: number } | null;
  /** Исходник: слов и шаблонных мест по правилам (для вкладки «Сравнение»). */
  source: { words: number; spots: number } | null;
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
 * Все три вкладки считаются один раз, сразу после нажатия: сводка в начале панели показывает итог по каждой.
 * Считаются по очереди, с паузой на отрисовку между этапами (читаемость, шаблоны, сравнение): на тексте в 30 000 слов
 * это не даёт интерфейсу замереть на сумму всех трёх. Проверка только читает документ.
 */
export function useTextCheck(doc: Doc | undefined): TextCheck {
  const [started, setStarted] = useState(false);
  const [tab, setTabState] = useState<FindingKind>('read');
  const [highlight, setHighlight] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Этап расчёта: 1 читаемость, 2 шаблоны, 3 сравнение. Следующий этап начинается после отрисовки предыдущего.
  const [stage, setStage] = useState(0);
  useEffect(() => {
    if (!started || stage >= 3) return;
    const timer = setTimeout(() => setStage(stage + 1), 0);
    return () => clearTimeout(timer);
  }, [started, stage]);

  const setTab = (t: FindingKind) => {
    setTabState(t);
  };

  const ct = useMemo(() => (started && doc ? buildCheckText(doc.blocks) : null), [started, doc]);
  const readability = useMemo(() => (ct ? timed('read', () => analyzeReadability(ct)) : null), [ct]);
  const patterns = useMemo<PatternsAnalysis | null>(
    () =>
      ct && stage >= 2
        ? timed('ai', () => ({ rules: findPatterns(ct), rhythm: analyzeRhythm(ct), openings: findOpenings(ct), diversity: analyzeDiversity(ct) }))
        : null,
    [ct, stage],
  );
  const sourceCt = useMemo(() => (started && doc && stage >= 3 ? buildSourceCheckText(doc.blocks) : null), [started, doc, stage]);
  const compare = useMemo(() => (ct && sourceCt ? timed('cmp', () => compareTexts(sourceCt, ct)) : null), [ct, sourceCt]);
  const stats = useMemo(() => {
    if (!ct) return null;
    const u = collectUnits(ct);
    return { words: u.words.length, sentences: u.sentences.length, paragraphs: new Set(u.sentences.map((x) => x.paragraph)).size };
  }, [ct]);
  const source = useMemo(
    () => (sourceCt ? { words: collectUnits(sourceCt).words.length, spots: findPatterns(sourceCt).length } : null),
    [sourceCt],
  );
  const findings = useMemo(
    () => (ct ? { read: readability ? readFindings(readability) : [], ai: patterns ? patternFindings(patterns) : [], cmp: compare ? compareFindings(compare) : [] } : EMPTY),
    [ct, readability, patterns, compare],
  );

  return {
    started,
    start: () => setStarted(true),
    ready: stage >= 3,
    ct,
    tab,
    setTab,
    highlight,
    setHighlight,
    readability,
    patterns,
    compare,
    stats,
    source,
    findings,
    activeId,
    open: setActiveId,
  };
}
