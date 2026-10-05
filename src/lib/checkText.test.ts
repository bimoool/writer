import { describe, expect, it } from 'vitest';
import { buildCheckText } from './checkText';

const block = (id: string, paragraphIndex: number, userText: string, kind: 'text' | 'heading' | 'list-item' = 'text') => ({ id, paragraphIndex, kind, userText });

describe('сборка текста для проверки', () => {
  it('блоки одного абзаца через пробел, абзацы через пустую строку', () => {
    const ct = buildCheckText([block('a', 0, ' Раз. '), block('b', 0, 'Два.'), block('c', 1, 'Три.')]);
    expect(ct.text).toBe('Раз. Два.\n\nТри.');
    expect(ct.paragraphs).toHaveLength(2);
  });
  it('пустые блоки пропускаются', () => {
    expect(buildCheckText([block('a', 0, 'Раз.'), block('b', 1, '  '), block('c', 2, 'Три.')]).text).toBe('Раз.\n\nТри.');
  });
  it('совпадает с текстом экспорта', async () => {
    const { assembleText } = await import('./io/export');
    const blocks = [block('a', 0, 'Заголовок', 'heading'), block('b', 1, ' Раз. '), block('c', 1, 'Два.'), block('d', 2, 'п', 'list-item')];
    const text = buildCheckText(blocks).text;
    expect(text.replace(/\n+/g, ' ')).toBe(assembleText(blocks).replace(/^- /gm, '').replace(/\n+/g, ' '));
  });
});
