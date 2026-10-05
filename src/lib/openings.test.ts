import { describe, expect, it } from 'vitest';
import { buildCheckText } from './checkText';
import { findOpenings, openingOf } from './openings';

const check = (text: string) => buildCheckText(text.split('\n\n').map((t, i) => ({ id: `b${i}`, paragraphIndex: i, kind: 'text' as const, userText: t })));
const starts = (text: string) => findOpenings(check(text)).map((g) => [g.scope, g.key, g.starts.map((s) => text.slice(s.start, s.end))]);

describe('начало предложения', () => {
  it('первое слово в нижнем регистре, ё как е', () => {
    expect(openingOf('Ёлка стоит.', 0)?.key).toBe('елка');
  });
  it('предлоги и союзы в начале пропускаются', () => {
    expect(openingOf('И в городе тихо.', 0)?.key).toBe('городе');
  });
  it('диапазон со смещением', () => {
    expect(openingOf('  В лесу тихо', 10)?.range).toEqual({ start: 14, end: 18 });
  });
  it('нет слов', () => expect(openingOf('123 ...', 0)).toBeNull());
});

describe('одинаковые начала предложений', () => {
  it('три подряд с одним первым словом', () => {
    expect(starts('Он пришёл рано. Он сел у окна. Он долго молчал. Потом ушёл.')).toEqual([['sentences', 'он', ['Он', 'Он', 'Он']]]);
  });
  it('два подряд не повтор', () => expect(starts('Он пришёл рано. Он сел у окна. Потом ушёл.')).toEqual([]));
  it('союзы и предлоги не считаются началом', () => {
    expect(starts('И он пришёл. И она пришла. И они ушли.')).toEqual([]);
    expect(starts('В доме тихо. В саду тихо. В лесу тихо.')).toEqual([]);
  });
  it('цепочка прерывается другим началом', () => {
    expect(starts('Он пришёл. Он сел. Она ушла. Он пел. Он ел.')).toEqual([]);
  });
  it('серии не переходят через границу абзаца', () => {
    expect(starts('Он пришёл. Он сел.\n\nОн ушёл.')).toEqual([]);
  });
});

describe('одинаковые начала абзацев', () => {
  it('три абзаца подряд', () => {
    const t = 'Сегодня было тепло.\n\nСегодня шёл дождь.\n\nСегодня я устал.\n\nЗавтра будет лучше.';
    const g = findOpenings(check(t)).filter((x) => x.scope === 'paragraphs');
    expect(g).toHaveLength(1);
    expect(g[0]!.starts.map((s) => t.slice(s.start, s.end))).toEqual(['Сегодня', 'Сегодня', 'Сегодня']);
  });
  it('два абзаца мало', () => {
    expect(findOpenings(check('Сегодня тепло.\n\nСегодня дождь.\n\nЗавтра солнце.')).filter((x) => x.scope === 'paragraphs')).toEqual([]);
  });
  it('пустой текст', () => expect(findOpenings(check(''))).toEqual([]));
});
