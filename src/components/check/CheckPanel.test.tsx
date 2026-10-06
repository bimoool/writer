import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { findPatterns } from '../../lib/aiCheck';
import { buildCheckText, buildSourceCheckText } from '../../lib/checkText';
import { compareTexts } from '../../lib/compare';
import { createDoc } from '../../lib/doc';
import { analyzeDiversity } from '../../lib/diversity';
import { compareFindings, patternFindings, readFindings, type FindingKind } from '../../lib/findings';
import { findOpenings } from '../../lib/openings';
import { analyzeReadability } from '../../lib/readability';
import { analyzeRhythm } from '../../lib/rhythm';
import { collectUnits } from '../../lib/textUnits';
import { CheckPanel } from './CheckPanel';
import type { TextCheck } from './useTextCheck';

const SOURCE = 'В современном мире важно отметить, что порядок помогает. Безусловно, это работает. Таким образом, всё просто и понятно.';

/** Собирает то же состояние, что useTextCheck после нажатия «Проверить текст». */
function checkOf(userTexts: string[], tab: FindingKind, source = SOURCE): TextCheck {
  const doc = createDoc(source);
  const blocks = doc.blocks.map((b, i) => ({ ...b, userText: userTexts[i] ?? '' }));
  const ct = buildCheckText(blocks);
  const sourceCt = buildSourceCheckText(blocks);
  const readability = analyzeReadability(ct);
  const patterns = { rules: findPatterns(ct), rhythm: analyzeRhythm(ct), openings: findOpenings(ct), diversity: analyzeDiversity(ct) };
  const compare = compareTexts(sourceCt, ct);
  const u = collectUnits(ct);
  return {
    started: true,
    start() {},
    ready: true,
    ct,
    tab,
    setTab() {},
    highlight: true,
    setHighlight() {},
    readability,
    patterns,
    compare,
    stats: { words: u.words.length, sentences: u.sentences.length, paragraphs: new Set(u.sentences.map((s) => s.paragraph)).size },
    source: { words: collectUnits(sourceCt).words.length, spots: findPatterns(sourceCt).length },
    findings: { read: readFindings(readability), ai: patternFindings(patterns), cmp: compareFindings(compare) },
    activeId: null,
    open() {},
  };
}

const textOf = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&quot;|&#x27;/g, "'").replace(/\s+/g, ' ');
const render = (check: TextCheck) => textOf(renderToStaticMarkup(<CheckPanel check={check} />));

const LIVE = 'Вчера я купил хлеб на углу, а продавщица долго искала сдачу и ворчала про погоду. Потом пошёл дождь, и мы оба смотрели в окно.';

describe('сводка в начале панели', () => {
  it('три строки: читаемость, шаблоны, сравнение', () => {
    const html = render(checkOf([LIVE], 'read'));
    expect(html).toMatch(/Читаемость.*индекс Флеша/);
    expect(html).toMatch(/Шаблоны не найдено\. Проверено \d+ слов\S*, \d+ предложени\S*, правил \d+/);
    expect(html).toMatch(/Сравнение перенесённых фраз и шаблонов нет/);
  });

  it('число шаблонов по категориям и перенесённое из исходника', () => {
    const html = render(checkOf([SOURCE], 'ai'));
    expect(html).toMatch(/Шаблоны \d+ мест\S* \(штампы \d+/);
    expect(html).toMatch(/перенесённых фраз [1-9]/);
  });

  it('пустой текст: читаемость называет причину', () => {
    const html = render(checkOf([], 'read'));
    expect(html).toMatch(/оценки нет: в тексте 0 слов и 0 предложений/);
    expect(html).toMatch(/Сравнение .*нет слов/);
  });
});

describe('пустые результаты объясняют себя', () => {
  it('«Шаблоны»: нулевой результат с числами', () => {
    const html = render(checkOf([LIVE], 'ai'));
    expect(html).toMatch(/Проверено \d+ слов\S*, 2 предложения, правил \d+: шаблонов не найдено/);
    expect(html).toMatch(/Проверено \d+ слов\S*, 2 предложения, правил \d+: словесного мусора не найдено/);
    expect(html).toContain('Нужно хотя бы 6 предложений, сейчас 2');
    expect(html).toMatch(/Нужно хотя бы 100 значимых слов, сейчас \d+/);
    expect(html).toContain('Проверено 2 предложения в 1 абзаце: 3 подряд с одним началом нет');
  });

  it('«Читаемость»: нулевые списки с причиной', () => {
    const html = render(checkOf([LIVE], 'read'));
    expect(html).toMatch(/Проверено 2 предложения: длиннее 25 слов нет/);
    expect(html).toMatch(/ни одно значимое слово не встречается 3 раза и больше в пределах 5 предложений/);
  });

  it('«Сравнение»: каждая пустота с причиной, без голых «нет»', () => {
    const html = render(checkOf([LIVE], 'cmp'));
    expect(html).toMatch(/твоего текста: 4 слов подряд, как в исходнике, нет/);
    expect(html).toMatch(/В исходнике шаблонных мест: \d+, ни одно не перешло/);
  });

  it('«Сравнение»: исходник без шаблонов', () => {
    const html = render(checkOf([LIVE], 'cmp', LIVE));
    expect(html).toMatch(/В исходнике шаблонов не нашлось, переносить было нечего/);
    expect(html).toMatch(/Проверено \d+ слов\S* исходника, правил \d+: шаблонов не найдено/);
  });
});
