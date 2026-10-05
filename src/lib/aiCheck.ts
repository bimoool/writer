import { JUNK_RULES, PHRASE_RULES, STRUCTURE_RULES, type PhraseRule } from './aiPatterns';
import type { CheckText, Range } from './checkText';

/** Поиск по правилам из aiPatterns.ts (SPEC §15.3). Результат — подсказки, а не оценка текста. */

export interface PatternFinding extends Range {
  ruleId: string;
  hint: string;
  category: 'cliche' | 'junk';
  /** Для словесного мусора: группа (ключ JUNK_GROUPS) и совет, чем заменить. */
  group?: string;
  advice?: string;
  /** Для структурных правил: числа для пояснения (например, «5 тире на 9 предложений»). */
  detail?: { dashes?: number; sentences?: number };
}

/** ё → е той же длины, чтобы смещения совпали с исходным текстом. */
const fold = (s: string) => s.replace(/ё/g, 'е').replace(/Ё/g, 'Е');

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function compile(rule: PhraseRule): RegExp {
  if (typeof rule.pattern === 'string') {
    const body = fold(rule.pattern).trim().split(/\s+/).map(escapeRe).join('\\s+');
    return new RegExp(`(?<![\\p{L}-])${body}(?![\\p{L}-])`, 'giu');
  }
  const flags = new Set(rule.pattern.flags.split(''));
  for (const f of ['g', 'i', 'u']) flags.add(f);
  return new RegExp(rule.pattern.source, [...flags].join(''));
}

function phraseFindings(ct: CheckText, rules: PhraseRule[]): PatternFinding[] {
  const folded = fold(ct.text);
  const out: PatternFinding[] = [];
  for (const rule of rules) {
    const found: PatternFinding[] = [];
    for (const m of folded.matchAll(compile(rule))) {
      const start = m.index;
      const end = start + m[0].length;
      if (end === start) continue;
      if (rule.paragraphStart && !ct.paragraphs.some((p) => p.kind !== 'heading' && p.start === start)) continue;
      found.push({ ruleId: rule.id, hint: rule.hint, category: rule.category ?? 'cliche', group: rule.group, advice: rule.advice, start, end });
    }
    if (found.length >= (rule.minCount ?? 1)) out.push(...found);
  }
  return out;
}

function dashFindings(ct: CheckText): PatternFinding[] {
  const rule = STRUCTURE_RULES.dashes;
  const sentenceCount = ct.paragraphs.reduce((n, p) => n + (p.kind === 'heading' ? 0 : p.sentences.length), 0);
  const dashes: number[] = [];
  for (const p of ct.paragraphs) {
    if (p.kind === 'heading') continue;
    for (let i = p.start; i < p.end; i++) {
      // Тире в начале абзаца — реплика диалога, а не авторская привычка.
      if (ct.text[i] === '—' && i > p.start) dashes.push(i);
    }
  }
  if (dashes.length < rule.minCount || dashes.length * rule.perSentences <= sentenceCount) return [];
  return dashes.map((start) => ({
    ruleId: rule.id,
    hint: rule.hint,
    category: 'cliche' as const,
    start,
    end: start + 1,
    detail: { dashes: dashes.length, sentences: sentenceCount },
  }));
}

function enumerationFindings(ct: CheckText): PatternFinding[] {
  const rule = STRUCTURE_RULES.enumeration;
  const out: PatternFinding[] = [];
  for (const p of ct.paragraphs) {
    if (p.kind === 'heading') continue;
    const text = fold(ct.text.slice(p.start, p.end)).toLowerCase();
    const found = rule.markers.map((variants) => {
      const re = new RegExp(`(?<![\\p{L}-])(?:${variants.map(escapeRe).join('|')})(?![\\p{L}-])`, 'u');
      const m = re.exec(text);
      return m ? { start: m.index, end: m.index + m[0].length } : null;
    });
    if (found.some((f) => !f) || !(found[0]!.start < found[1]!.start && found[1]!.start < found[2]!.start)) continue;
    out.push({ ruleId: rule.id, hint: rule.hint, category: 'cliche', start: p.start + found[0]!.start, end: p.start + found[2]!.end });
  }
  return out;
}

/** Все подсказки по тексту, по порядку появления. */
export function findPatterns(ct: CheckText, rules: PhraseRule[] = [...PHRASE_RULES, ...JUNK_RULES]): PatternFinding[] {
  return [...phraseFindings(ct, rules), ...dashFindings(ct), ...enumerationFindings(ct)].sort(
    (a, b) => a.start - b.start || a.end - b.end,
  );
}
