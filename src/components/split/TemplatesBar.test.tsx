import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createDoc } from '../../lib/doc';
import { SYNC_SOURCE_CHARS } from '../../lib/sourceTemplates';
import { TemplatesBar } from './TemplatesBar';

const PHRASES = 'В современном мире важно отметить, что порядок помогает. Безусловно, это работает. ';

describe('строка шаблонов исходника', () => {
  it('небольшой исходник считается сразу и показывает сводку', () => {
    const doc = createDoc(PHRASES.repeat(3));
    const html = renderToStaticMarkup(<TemplatesBar docId={doc.id} blocks={doc.blocks} onShow={() => {}} />);
    expect(html).toContain('В исходнике найдено');
    expect(html).toContain('Показать в тексте');
    expect(html).not.toContain('Считаем');
  });

  it('без шаблонов пишет об этом и не показывает переключатель', () => {
    const doc = createDoc('Вчера я купил хлеб на углу, а продавщица долго искала сдачу и ворчала про погоду.');
    const html = renderToStaticMarkup(<TemplatesBar docId={doc.id} blocks={doc.blocks} onShow={() => {}} />);
    expect(html).toContain('Шаблонов из нашего списка в исходнике не нашлось');
    expect(html).not.toContain('Показать в тексте');
  });

  it('большой исходник начинает со строки «Считаем…»', () => {
    const doc = createDoc(PHRASES.repeat(Math.ceil(SYNC_SOURCE_CHARS / PHRASES.length) + 20).replace(/\. /g, '.\n\n'));
    const html = renderToStaticMarkup(<TemplatesBar docId={doc.id} blocks={doc.blocks} onShow={() => {}} />);
    expect(html).toContain('Считаем шаблоны исходника…');
  });
});
