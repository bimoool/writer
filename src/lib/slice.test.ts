import { describe, expect, it } from 'vitest';
import { findPatterns, findPatternsSteps } from './aiCheck';
import { buildCheckText, buildCheckTextSteps } from './checkText';
import { createDoc } from './doc';
import { drain, runSliced } from './slice';
import { analyzeSourceTemplates, sourceTemplatesAsync, sourceTemplatesFor } from './sourceTemplates';

function* counter(n: number) {
  let sum = 0;
  for (let i = 1; i <= n; i++) {
    sum += i;
    yield;
  }
  return sum;
}

const TEXT = `${'В современном мире важно отметить, что порядок помогает. Давайте разберёмся, как это работает. '.repeat(6)}\n\n${'Сон — это основа. Режим — это ритм. Покой — это сила. '.repeat(4)}`;
const blocksOf = () => createDoc(TEXT, { newId: (() => { let n = 0; return () => `i${++n}`; })() }).blocks.map((b) => ({ ...b, userText: b.sourceText }));

describe('вычисления порциями', () => {
  it('drain доводит генератор до результата', () => expect(drain(counter(5))).toBe(15));

  it('runSliced отдаёт управление между порциями и возвращает тот же результат', async () => {
    let ticks = 0;
    const timer = setInterval(() => ticks++, 0);
    const result = await runSliced(counter(200), undefined, 0);
    clearInterval(timer);
    expect(result).toBe(20100);
    expect(ticks).toBeGreaterThan(0);
  });

  it('отмена останавливает вычисление', async () => {
    const abort = new AbortController();
    const p = runSliced(counter(1000), abort.signal, 0);
    abort.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('сборка текста и поиск шаблонов порциями дают то же, что целиком', () => {
    const blocks = blocksOf();
    expect(drain(buildCheckTextSteps(blocks))).toEqual(buildCheckText(blocks));
    const ct = buildCheckText(blocks);
    expect(drain(findPatternsSteps(ct))).toEqual(findPatterns(ct));
  });

  it('шаблоны исходника: порциями и целиком совпадают, результат кэшируется', async () => {
    const doc = createDoc(TEXT, { newId: (() => { let n = 0; return () => `j${++n}`; })() });
    const whole = analyzeSourceTemplates(doc.blocks);
    expect(whole.counts.total).toBeGreaterThan(0);
    const sliced = await sourceTemplatesAsync('doc-async', doc.blocks);
    expect(sliced.counts).toEqual(whole.counts);
    expect(sliced.spots).toEqual(whole.spots);
    expect(sourceTemplatesFor('doc-async', doc.blocks)).toBe(sliced);
    expect(await sourceTemplatesAsync('doc-async', doc.blocks)).toBe(sliced);
  });
});
