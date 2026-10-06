import { describe, expect, it } from 'vitest';
import { createDoc } from './doc';
import { analyzeSourceTemplates, sourceTemplatesFor, spotsByBlock, templatePieces } from './sourceTemplates';

const STAMPS =
  'В современном мире тема важна. Важно отметить, что порядок помогает. По сути это работает. Безусловно, результат заметен.';
const PLAIN = 'Вчера я купил хлеб на углу. Продавщица долго искала сдачу и ворчала про погоду. Потом пошёл дождь.';

const docOf = (text: string) => createDoc(text, { newId: (() => { let n = 0; return () => `id${++n}`; })() });

describe('analyzeSourceTemplates', () => {
  it('считает штампы и словесный мусор по категориям', () => {
    const doc = docOf(STAMPS);
    const t = analyzeSourceTemplates(doc.blocks);
    expect(t.counts.cliche).toBeGreaterThanOrEqual(2);
    expect(t.counts.junk).toBeGreaterThanOrEqual(2);
    expect(t.counts.total).toBe(t.counts.cliche + t.counts.junk + t.counts.rhythm);
    expect(t.spots).toHaveLength(t.counts.total);
  });

  it('у живого текста шаблонов нет', () => {
    expect(analyzeSourceTemplates(docOf(PLAIN).blocks).counts.total).toBe(0);
  });

  it('ровный ритм считается, только когда хватает предложений', () => {
    const even = 'Один два три четыре пять шесть. Семь восемь девять десять один два. Три четыре пять шесть семь восемь. Девять десять один два три четыре. Пять шесть семь восемь девять десять. Один два три четыре пять шесть.';
    expect(analyzeSourceTemplates(docOf(even).blocks).counts.rhythm).toBeGreaterThan(0);
    expect(analyzeSourceTemplates(docOf('Один два три четыре пять шесть. Семь восемь девять десять один два.').blocks).counts.rhythm).toBe(0);
  });
});

describe('spotsByBlock', () => {
  it('кладёт подсветку в координаты sourceText блока', () => {
    const doc = docOf(`${PLAIN}\n\n${STAMPS}`);
    const t = analyzeSourceTemplates(doc.blocks);
    const byBlock = spotsByBlock(t, doc.blocks);
    let found = 0;
    for (const b of doc.blocks) {
      for (const s of byBlock.get(b.id) ?? []) {
        found++;
        expect(s.start).toBeGreaterThanOrEqual(0);
        expect(s.end).toBeLessThanOrEqual(b.sourceText.length);
      }
    }
    expect(found).toBeGreaterThan(0);
    const phrases = doc.blocks.flatMap((b) => (byBlock.get(b.id) ?? []).filter((s) => s.kind === 'cliche').map((s) => b.sourceText.slice(s.start, s.end).toLowerCase()));
    expect(phrases).toContain('в современном мире');
  });
});

describe('sourceTemplatesFor', () => {
  it('кэширует результат по документу', () => {
    const doc = docOf(STAMPS);
    expect(sourceTemplatesFor(doc.id, doc.blocks)).toBe(sourceTemplatesFor(doc.id, doc.blocks));
  });
});

describe('templatePieces', () => {
  it('режет по границам и не теряет текст', () => {
    const pieces = templatePieces(0, 20, [
      { kind: 'junk', start: 5, end: 10 },
      { kind: 'cliche', start: 8, end: 14 },
    ]);
    expect(pieces.map((p) => [p.start, p.end, p.kind])).toEqual([
      [0, 5, null],
      [5, 8, 'junk'],
      [8, 14, 'cliche'],
      [14, 20, null],
    ]);
  });
  it('без подсветки один кусок', () => {
    expect(templatePieces(3, 9, [])).toEqual([{ start: 3, end: 9, kind: null }]);
  });
});
