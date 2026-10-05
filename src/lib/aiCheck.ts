import { STRUCTURE_RULES, PHRASE_RULES, type PhraseRule } from './aiPatterns';
import type { CheckText, Range } from './checkText';

/** Поиск по правилам из aiPatterns.ts (SPEC §15.3). Результат — подсказки, а не оценка текста. */

export interface PatternFinding extends Range {
  ruleId: string;
  hint: string;
  /** Для структурных правил: числа для пояснения (например, «5 тире на 9 предложений»). */
  detail?: { dashes?: number; sentences?: number; run?: number };
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
    for (const m of folded.matchAll(compile(rule))) {
      const start = m.index;
      const end = start + m[0].length;
      if (end === start) continue;
      if (rule.paragraphStart && !ct.paragraphs.some((p) => p.kind !== 'heading' && p.start === start)) continue;
      out.push({ ruleId: rule.id, hint: rule.hint, start, end });
    }
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
    start,
    end: start + 1,
    detail: { dashes: dashes.length, sentences: sentenceCount },
  }));
}

function evenLengthFindings(ct: CheckText): PatternFinding[] {
  const rule = STRUCTURE_RULES.evenLength;
  const out: PatternFinding[] = [];
  for (const p of ct.paragraphs) {
    if (p.kind === 'heading') continue;
    const lengths = p.sentences.map((s) => ct.text.slice(s.start, s.end).match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu)?.length ?? 0);
    let runStart = -1;
    let runEnd = -1;
    const flush = () => {
      if (runStart < 0) return;
      out.push({
        ruleId: rule.id,
        hint: rule.hint,
        start: p.sentences[runStart]!.start,
        end: p.sentences[runEnd]!.end,
        detail: { run: runEnd - runStart + 1 },
      });
      runStart = -1;
    };
    for (let i = 0; i + rule.run <= lengths.length; i++) {
      const w = lengths.slice(i, i + rule.run);
      const max = Math.max(...w);
      const even = Math.min(...w) >= rule.minWords && (max - Math.min(...w)) / max < rule.maxDiff;
      if (even) {
        if (runStart >= 0 && i <= runEnd) runEnd = i + rule.run - 1;
        else {
          flush();
          runStart = i;
          runEnd = i + rule.run - 1;
        }
      }
    }
    flush();
  }
  return out;
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
    out.push({ ruleId: rule.id, hint: rule.hint, start: p.start + found[0]!.start, end: p.start + found[2]!.end });
  }
  return out;
}

/** Все подсказки по тексту, по порядку появления. */
export function findPatterns(ct: CheckText, rules: PhraseRule[] = PHRASE_RULES): PatternFinding[] {
  return [...phraseFindings(ct, rules), ...dashFindings(ct), ...evenLengthFindings(ct), ...enumerationFindings(ct)].sort(
    (a, b) => a.start - b.start || a.end - b.end,
  );
}
