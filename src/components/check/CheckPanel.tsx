import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { ru } from '../../i18n/ru';
import { DIVERSITY, JUNK_GROUPS, RHYTHM } from '../../lib/aiPatterns';
import { CARRY_WORDS } from '../../lib/compare';
import type { Finding, FindingKind } from '../../lib/findings';
import type { TextCheck } from './useTextCheck';

const quiet =
  'min-h-12 rounded-surface px-3 text-ui text-text-dim transition-colors duration-[120ms] hover:text-text disabled:opacity-60';
const item =
  'flex min-h-11 w-full min-w-0 flex-col items-start rounded-surface px-3 py-2 text-left text-ui text-text transition-colors duration-[120ms] hover:bg-surface';

const TABS: FindingKind[] = ['read', 'ai', 'cmp'];
const tabName = (k: FindingKind) => (k === 'read' ? ru.check.tabRead : k === 'ai' ? ru.check.tabPatterns : ru.check.tabCompare);

const flat = (n: number) => n.toFixed(1).replace('.', ',');

/** Кусок текста для строки списка: до 70 знаков. */
const excerpt = (text: string, f: { start: number; end: number }) => {
  const s = text.slice(f.start, f.end);
  return s.length > 70 ? `${s.slice(0, 70).trimEnd()}…` : s;
};

function FindingList({ check, list, label }: { check: TextCheck; list: Finding[]; label: (f: Finding) => { title: string; note?: string } }) {
  const text = check.ct?.text ?? '';
  return (
    <ul className="m-0 mt-2 flex list-none flex-col gap-0.5 p-0">
      {list.map((f) => {
        const { title, note } = label(f);
        return (
          <li key={f.id}>
            <button
              type="button"
              className={item}
              aria-label={`${ru.check.inText}: ${title}`}
              onClick={() => check.open(f.id)}
              data-list-item={f.id}
            >
              <span className="[overflow-wrap:anywhere]">{title || excerpt(text, f)}</span>
              {note && <span className="text-meta text-text-dim">{note}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ReadTab({ check }: { check: TextCheck }) {
  const r = check.readability;
  if (!r) return null;
  const long = check.findings.read.filter((f) => f.kind === 'read' && f.sub === 'long');
  // В списке повтор один раз по слову; в тексте подсвечены все вхождения.
  const repeats = r.repeats
    .map((g) => check.findings.read.find((f) => f.id === `read:repeat:${g.occurrences[0]!.start}`))
    .filter((f): f is Finding => !!f);
  const stats: Array<[string, string]> = [
    [ru.check.read.words, String(r.words)],
    [ru.check.read.sentences, String(r.sentences)],
    [ru.check.read.avgSentence, flat(r.wordsPerSentence)],
    [ru.check.read.longWords, `${Math.round(r.longWordShare * 100)}%`],
  ];
  return (
    <div>
      {r.score === null || r.level === null ? (
        <p className="text-ui text-text-dim">{ru.check.read.tooShort}</p>
      ) : (
        <div>
          <p className="text-meta text-text-dim">{ru.check.read.levelLabel}</p>
          <p className="font-serif text-h2 text-text">{ru.check.read.level[r.level]}</p>
          <p className="text-ui tabular-nums text-text">{ru.check.read.score(flat(r.score))}</p>
          <p className="mt-1 max-w-[32rem] text-meta text-text-dim">{ru.check.read.scoreNote}</p>
        </div>
      )}
      <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-3">
        {stats.map(([label, value]) => (
          <div key={label} className="flex items-baseline gap-1.5">
            <dt className="text-meta text-text-dim">{label}</dt>
            <dd className="text-ui tabular-nums text-text">{value}</dd>
          </div>
        ))}
      </dl>
      <h3 className="mt-5 text-ui font-medium text-text">{ru.check.read.longSentences}</h3>
      {long.length === 0 ? (
        <p className="mt-1 text-ui text-text-dim">{ru.check.read.longSentencesNone}</p>
      ) : (
        <FindingList check={check} list={long} label={(f) => ({ title: excerpt(check.ct?.text ?? '', f), note: f.kind === 'read' && f.sub === 'long' ? ru.check.read.longSentence(f.words) : undefined })} />
      )}
      <h3 className="mt-5 text-ui font-medium text-text">{ru.check.read.repeats}</h3>
      {repeats.length === 0 ? (
        <p className="mt-1 text-ui text-text-dim">{ru.check.read.repeatsNone}</p>
      ) : (
        <FindingList
          check={check}
          list={repeats}
          label={(f) => ({ title: f.kind === 'read' && f.sub === 'repeat' ? ru.check.read.repeat(f.word, f.count, f.span) : '' })}
        />
      )}
    </div>
  );
}

function Section({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return (
    <section className="mt-5 first:mt-0">
      <h3 className="text-ui font-medium text-text">{title}</h3>
      {note && <p className="mt-0.5 max-w-[32rem] text-meta text-text-dim">{note}</p>}
      {children}
    </section>
  );
}

const pct = (x: number) => Math.round(x * 100);

function PatternsTab({ check }: { check: TextCheck }) {
  const a = check.patterns;
  const text = check.ct?.text ?? '';
  if (!a) return null;
  const list = check.findings.ai;
  const rules = list.filter((f) => f.sub === 'rule');
  const cliche = rules.filter((f) => f.sub === 'rule' && f.category === 'cliche');
  const junk = rules.filter((f) => f.sub === 'rule' && f.category === 'junk');
  const chains = list.filter((f) => f.sub === 'rhythm');
  const lowWindows = list.filter((f) => f.sub === 'diversity');
  // Одинаковые начала: в списке одна строка на группу, в тексте подсвечены все начала.
  const groupFirst = new Map<string, Finding>();
  for (const f of list) if (f.sub === 'start' && !groupFirst.has(`${f.scope}:${f.key}:${f.count}`)) groupFirst.set(`${f.scope}:${f.key}:${f.count}`, f);
  const openingGroups = [...groupFirst.values()];
  const stats = a.rhythm.stats;
  const junkGroups = [...new Set(junk.map((f) => (f.sub === 'rule' ? (f.group ?? '') : '')))];

  return (
    <div>
      <p className="max-w-[32rem] text-ui text-text-dim">{ru.check.patterns.note}</p>

      <Section title={ru.check.patterns.cliche}>
        <p role="status" className="mt-1 text-ui text-text">
          {cliche.length === 0 ? ru.check.patterns.clicheNone : ru.check.patterns.found(cliche.length)}
        </p>
        <FindingList
          check={check}
          list={cliche}
          label={(f) => {
            if (f.sub !== 'rule') return { title: '' };
            const title = f.detail?.dashes ? ru.check.patterns.dashes(f.detail.dashes, f.detail.sentences ?? 0) : excerpt(text, f);
            return { title, note: f.hint };
          }}
        />
      </Section>

      <Section title={ru.check.patterns.junk} note={ru.check.patterns.junkNote}>
        {junk.length === 0 ? (
          <p className="mt-1 text-ui text-text-dim">{ru.check.patterns.junkNone}</p>
        ) : (
          junkGroups.map((g) => (
            <div key={g} className="mt-2">
              <p className="text-meta text-text-dim">{JUNK_GROUPS[g] ?? g}</p>
              <FindingList
                check={check}
                list={junk.filter((f) => f.sub === 'rule' && (f.group ?? '') === g)}
                label={(f) => ({ title: excerpt(text, f), note: f.sub === 'rule' && f.advice ? ru.check.patterns.advice(f.advice) : undefined })}
              />
            </div>
          ))
        )}
      </Section>

      <Section title={ru.check.patterns.rhythm}>
        {a.rhythm.status === 'tooShort' ? (
          <p className="mt-1 text-ui text-text-dim">{ru.check.patterns.rhythmTooShort(RHYTHM.minSentences)}</p>
        ) : (
          <>
            <p className="mt-1 font-serif text-h2 text-text">{a.rhythm.status === 'even' ? ru.check.patterns.rhythmEven : ru.check.patterns.rhythmLively}</p>
            <p className="max-w-[32rem] text-meta text-text-dim">{ru.check.patterns.rhythmStats(flat(stats.mean), flat(stats.sd), stats.cv.toFixed(2).replace('.', ','))}</p>
            <h4 className="mt-3 text-meta text-text-dim">{ru.check.patterns.chains}</h4>
            {chains.length === 0 ? (
              <p className="text-ui text-text-dim">{ru.check.patterns.chainsNone}</p>
            ) : (
              <FindingList check={check} list={chains} label={(f) => ({ title: f.sub === 'rhythm' ? ru.check.patterns.chain(f.count, f.words) : '', note: excerpt(text, f) })} />
            )}
          </>
        )}
      </Section>

      <Section title={ru.check.patterns.openings}>
        {openingGroups.length === 0 ? (
          <p className="mt-1 text-ui text-text-dim">{ru.check.patterns.openingsNone}</p>
        ) : (
          <FindingList check={check} list={openingGroups} label={(f) => ({ title: f.sub === 'start' ? ru.check.patterns.opening(f.key, f.count, f.scope) : '' })} />
        )}
      </Section>

      <Section title={ru.check.patterns.diversity}>
        {a.diversity.status === 'tooShort' ? (
          <p className="mt-1 text-ui text-text-dim">{ru.check.patterns.diversityTooShort(a.diversity.significant, DIVERSITY.window)}</p>
        ) : (
          <>
            <p className="mt-1 text-ui tabular-nums text-text">{ru.check.patterns.diversityMean(pct(a.diversity.mean))}</p>
            <h4 className="mt-3 text-meta text-text-dim">{ru.check.patterns.diversityLow}</h4>
            {lowWindows.length === 0 ? (
              <p className="text-ui text-text-dim">{ru.check.patterns.diversityNone}</p>
            ) : (
              <FindingList
                check={check}
                list={lowWindows}
                label={(f) => ({
                  title: f.sub === 'diversity' ? ru.check.patterns.diversityWindow(pct(f.ratio), pct(f.mean)) : '',
                  note: f.sub === 'diversity' && f.top.length ? ru.check.patterns.diversityTop(f.top) : undefined,
                })}
              />
            )}
          </>
        )}
      </Section>
    </div>
  );
}

function CompareTab({ check }: { check: TextCheck }) {
  const c = check.compare;
  const text = check.ct?.text ?? '';
  if (!c) return null;
  if (c.status === 'noSource') return <p className="text-ui text-text-dim">{ru.check.compare.noSource}</p>;
  if (c.status === 'noText') return <p className="text-ui text-text-dim">{ru.check.compare.noText}</p>;
  const carried = check.findings.cmp.filter((f) => f.sub === 'pattern');
  const phrases = check.findings.cmp.filter((f) => f.sub === 'phrase');
  return (
    <div>
      <p className="max-w-[32rem] text-ui text-text-dim">{ru.check.compare.note}</p>

      <Section title={ru.check.compare.phrases} note={ru.check.compare.phrasesNote(CARRY_WORDS)}>
        {phrases.length === 0 ? (
          <p role="status" className="mt-1 text-ui text-text">
            {ru.check.compare.phrasesNone}
          </p>
        ) : (
          <FindingList check={check} list={phrases} label={(f) => ({ title: excerpt(text, f), note: f.sub === 'phrase' ? ru.check.compare.phraseWords(f.words) : undefined })} />
        )}
      </Section>

      <Section title={ru.check.compare.carried}>
        {carried.length === 0 ? (
          <p role="status" className="mt-1 text-ui text-text">
            {ru.check.compare.carriedNone}
          </p>
        ) : (
          <FindingList check={check} list={carried} label={(f) => ({ title: excerpt(text, f), note: ru.check.compare.carriedLabel })} />
        )}
      </Section>

      <Section title={ru.check.compare.gone} note={c.gonePatterns.length ? ru.check.compare.goneNote : undefined}>
        {c.gonePatterns.length === 0 ? (
          <p className="mt-1 text-ui text-text-dim">{ru.check.compare.goneNone}</p>
        ) : (
          <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
            {c.gonePatterns.map((g) => (
              <li key={g.ruleId} className="px-3 text-ui text-text [overflow-wrap:anywhere]">
                {ru.check.compare.goneItem(g.example, g.count)}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

/** Кнопка «Проверить текст» и панель с тремя вкладками (SPEC §15.4). Шаблон вкладок WAI-ARIA: стрелки переключают. */
export function CheckPanel({ check }: { check: TextCheck }) {
  const id = useId();
  const tabs = useRef<Record<FindingKind, HTMLButtonElement | null>>({ read: null, ai: null, cmp: null });

  if (!check.started) return null;

  const onKey = (e: KeyboardEvent) => {
    const i = TABS.indexOf(check.tab);
    const next =
      e.key === 'ArrowRight' ? TABS[(i + 1) % TABS.length] : e.key === 'ArrowLeft' ? TABS[(i + TABS.length - 1) % TABS.length] : e.key === 'Home' ? TABS[0] : e.key === 'End' ? TABS[TABS.length - 1] : null;
    if (!next) return;
    e.preventDefault();
    check.setTab(next);
    tabs.current[next]?.focus();
  };

  return (
    <section aria-labelledby={`${id}-title`} className="mt-10 min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 id={`${id}-title`} className="font-serif text-h2 text-text">
          {ru.check.title}
        </h2>
        <button type="button" className={`${quiet} -mr-3`} aria-pressed={check.highlight} onClick={() => check.setHighlight(!check.highlight)}>
          {check.highlight ? ru.check.highlightOff : ru.check.highlightOn}
        </button>
      </div>
      <div role="tablist" aria-label={ru.check.tabs} className="-ml-3 mt-1 flex flex-wrap gap-1 border-b border-line" onKeyDown={onKey}>
        {TABS.map((k) => {
          const count = k === 'read' ? (check.readability ? check.readability.longSentences.length + check.readability.repeats.length : 0) : check.findings[k].length;
          return (
            <button
              key={k}
              ref={(el) => {
                tabs.current[k] = el;
              }}
              type="button"
              role="tab"
              id={`${id}-${k}-tab`}
              aria-selected={check.tab === k}
              aria-controls={`${id}-${k}-panel`}
              tabIndex={check.tab === k ? 0 : -1}
              onClick={() => check.setTab(k)}
              className={`-mb-px min-h-12 border-b-2 px-3 text-ui transition-colors duration-[120ms] ${
                check.tab === k ? 'border-ink text-text' : 'border-transparent text-text-dim hover:text-text'
              }`}
            >
              {tabName(k)}
              {count !== null && count > 0 && <span className="ml-1.5 text-meta tabular-nums text-text-dim">{ru.check.count(count)}</span>}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`${id}-${check.tab}-panel`} aria-labelledby={`${id}-${check.tab}-tab`} data-check-panel tabIndex={-1} className="pt-4 outline-offset-4">
        {check.tab === 'read' ? <ReadTab check={check} /> : check.tab === 'ai' ? <PatternsTab check={check} /> : <CompareTab check={check} />}
      </div>
    </section>
  );
}
