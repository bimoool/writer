import { describe, expect, it } from 'vitest';
import { APPENDIX_A } from './__fixtures__/appendix-a';
import { NORMAL_TEXTS, RETELLINGS } from './__fixtures__/calibration';
import { findPatterns } from './aiCheck';
import { PHRASE_RULES, JUNK_RULES } from './aiPatterns';
import { buildCheckText } from './checkText';
import { carriedPhrases } from './compare';
import { analyzeDiversity } from './diversity';
import { findOpenings } from './openings';
import { analyzeReadability } from './readability';
import { analyzeRhythm } from './rhythm';
import { countWords } from './tokens';

/**
 * Калибровка правил (SPEC §15.7). На обычных живых текстах ни одно правило не должно срабатывать чаще одного раза на
 * 100 слов. Таблицу срабатываний печатает `CALIBRATION=1 npx vitest run src/lib/calibration.test.ts`.
 */

const ct = (text: string) => buildCheckText(text.split(/\n\n+/).map((t, i) => ({ id: `b${i}`, paragraphIndex: i, kind: 'text' as const, userText: t })));

const MATERIALS: Record<string, string> = {
  'Прил. A (исходник)': APPENDIX_A,
  'пересказ: близко': RETELLINGS.close,
  'пересказ: средне': RETELLINGS.medium,
  'пересказ: по-своему': RETELLINGS.own,
  'обычный: письмо': NORMAL_TEXTS.message,
  'обычный: отчёт': NORMAL_TEXTS.report,
  'обычный: блог': NORMAL_TEXTS.blog,
  'обычный: отзыв': NORMAL_TEXTS.review,
  'обычный: болтовня': NORMAL_TEXTS.chat,
  'обычный: все пять': Object.values(NORMAL_TEXTS).join('\n\n'),
};

/** Срабатывания по правилам: id → число мест. */
function hits(text: string): Record<string, number> {
  const t = ct(text);
  const out: Record<string, number> = {};
  const add = (id: string, n = 1) => (out[id] = (out[id] ?? 0) + n);
  for (const f of findPatterns(t)) add(f.ruleId);
  const rh = analyzeRhythm(t);
  if (rh.status === 'even') add('rhythm-even');
  for (const _ of rh.chains) add('rhythm-chain');
  for (const _ of findOpenings(t)) add('openings');
  const dv = analyzeDiversity(t);
  for (const w of dv.windows) if (w.low) add('diversity-low');
  const r = analyzeReadability(t);
  for (const _ of r.longSentences) add('long-sentence');
  for (const _ of r.repeats) add('word-repeat');
  return out;
}

const allIds = [...PHRASE_RULES, ...JUNK_RULES].map((r) => r.id).concat(['dashes', 'enumeration', 'rhythm-even', 'rhythm-chain', 'openings', 'diversity-low', 'long-sentence', 'word-repeat']);

describe('калибровка', () => {
  const table = Object.fromEntries(Object.entries(MATERIALS).map(([name, text]) => [name, hits(text)]));

  it.runIf(process.env.CALIBRATION)('печатает таблицу', () => {
    const names = Object.keys(MATERIALS);
    const rows = allIds.filter((id) => names.some((n) => table[n]![id])).map((id) => `${id.padEnd(22)}${names.map((n) => String(table[n]![id] ?? 0).padStart(5)).join('')}`);
    const head = `${'правило'.padEnd(22)}${names.map((_, i) => String(i + 1).padStart(5)).join('')}`;
    const words = names.map((n) => countWords(MATERIALS[n]!));
    const carried = names.map((n) => (n === 'Прил. A (исходник)' ? '-' : carriedPhrases(ct(APPENDIX_A), ct(MATERIALS[n]!)).length));
    const cvs = names.map((n) => analyzeRhythm(ct(MATERIALS[n]!)).stats.cv.toFixed(2));
    const dvs = names.map((n) => { const d = analyzeDiversity(ct(MATERIALS[n]!)); return d.status === 'tooShort' ? `мало(${d.significant})` : d.windows.map((w) => w.ratio.toFixed(2)).join('/'); });
    console.log(`\n${names.map((n, i) => `${i + 1}=${n} (${words[i]} слов)`).join('\n')}\n\n${head}\n${rows.join('\n')}\nперенесённых фраз: ${carried.join(' ')}\nразнообразие слов по окнам: ${dvs.join(' ')}\nкоэффициент вариации длины предложений: ${cvs.join(' ')}`);
  });

  it('ритм обычных текстов не «ровный»', () => {
    for (const name of Object.keys(MATERIALS).filter((n) => n.startsWith('обычный'))) expect(table[name]!['rhythm-even'], name).toBeUndefined();
  });

  it('на обычных текстах ни одно правило не срабатывает чаще раза на 100 слов', () => {
    for (const name of Object.keys(MATERIALS).filter((n) => n.startsWith('обычный'))) {
      const words = countWords(MATERIALS[name]!);
      for (const [id, n] of Object.entries(table[name]!)) {
        expect(n / words, `${name}: ${id} ×${n}`).toBeLessThanOrEqual(1 / 100);
      }
    }
  });
});
