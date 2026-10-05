import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { findPatterns } from '../../lib/aiCheck';
import { buildCheckText, partAt, replaceInDoc, type CheckText } from '../../lib/checkText';
import { aiFindings, readFindings, spellFindings, type Finding, type FindingKind } from '../../lib/findings';
import { analyzeReadability, type Readability } from '../../lib/readability';
import { spellCandidates } from '../../lib/spell';
import { startSpell, type SpellEngine } from '../../lib/spellClient';
import { useApp } from '../../store/app';
import type { Doc } from '../../lib/types';

export type SpellStatus = 'idle' | 'loading' | 'checking' | 'ready' | 'error';

export interface TextCheck {
  started: boolean;
  start(): void;
  ct: CheckText | null;
  tab: FindingKind;
  setTab(tab: FindingKind): void;
  highlight: boolean;
  setHighlight(on: boolean): void;
  spellStatus: SpellStatus;
  retrySpell(): void;
  readability: Readability | null;
  findings: Record<FindingKind, Finding[]>;
  /** Открытая находка (карточка с пояснением). */
  activeId: string | null;
  open(id: string | null): void;
  /** Сообщение для скринридера после замены. */
  notice: 'replaced' | null;
  suggestions(word: string): Promise<string[]>;
  replace(finding: Finding, replacement: string): void;
}

const EMPTY: Record<FindingKind, Finding[]> = { spell: [], read: [], ai: [] };

/**
 * Состояние проверки текста на экране Result (SPEC §15). Пока не нажата «Проверить текст», ничего не считается и словарь
 * не загружается. Проверка только читает документ; единственная запись в него — замена слова, выбранная пользователем.
 */
export function useTextCheck(doc: Doc | undefined): TextCheck {
  const [started, setStarted] = useState(false);
  const [tab, setTab] = useState<FindingKind>('spell');
  const [highlight, setHighlight] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [engine, setEngine] = useState<SpellEngine | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [spell, setSpell] = useState<{ bad: Set<string> } | null>(null);
  const [notice, setNotice] = useState<'replaced' | null>(null);
  const cache = useRef(new Map<string, string[]>());

  const ct = useMemo(() => (started && doc ? buildCheckText(doc.blocks) : null), [started, doc]);
  const checkText = ct;

  const readability = useMemo(() => (checkText ? analyzeReadability(checkText) : null), [checkText]);
  const patterns = useMemo(() => (checkText ? aiFindings(findPatterns(checkText)) : []), [checkText]);

  const load = useCallback(() => {
    setLoadFailed(false);
    startSpell().then(setEngine, () => setLoadFailed(true));
  }, []);

  useEffect(() => {
    if (!engine || !checkText) return;
    let alive = true;
    const words = [...new Set(spellCandidates(checkText.text).map((c) => c.word))];
    engine.check(words).then(
      (bad) => alive && setSpell({ bad }),
      () => alive && setLoadFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [engine, checkText]);

  const spellStatus: SpellStatus = !started
    ? 'idle'
    : loadFailed
      ? 'error'
      : !engine
        ? 'loading'
        : spell
          ? 'ready'
          : 'checking';

  const spellList = useMemo(
    // Набор неверных слов остаётся годным и после замены одного слова: ждать повторной проверки не нужно.
    () => (checkText && spell ? spellFindings(checkText, spell.bad) : []),
    [checkText, spell],
  );
  const findings = useMemo(
    () => (checkText ? { spell: spellList, read: readability ? readFindings(readability) : [], ai: patterns } : EMPTY),
    [checkText, spellList, readability, patterns],
  );

  const suggestions = useCallback(
    async (word: string) => {
      const hit = cache.current.get(word);
      if (hit) return hit;
      const list = engine ? await engine.suggest(word) : [];
      cache.current.set(word, list);
      return list;
    },
    [engine],
  );

  const replace = useCallback(
    (finding: Finding, replacement: string) => {
      if (!doc || !checkText) return;
      const part = partAt(checkText.parts, finding.start);
      if (!part || finding.end > part.end) return;
      // Как любая правка документа: через updateDoc, он ставит updatedAt и запускает автосохранение.
      useApp.getState().updateDoc(doc.id, (d) => replaceInDoc(d, part, finding, replacement));
      setActiveId(null);
      setNotice('replaced');
    },
    [doc, checkText],
  );

  return {
    started,
    start: () => {
      setStarted(true);
      if (!engine) load();
    },
    ct: checkText,
    tab,
    setTab,
    highlight,
    setHighlight,
    spellStatus,
    retrySpell: load,
    readability,
    findings,
    activeId,
    open: setActiveId,
    notice,
    suggestions,
    replace,
  };
}
