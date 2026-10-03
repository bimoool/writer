import type { BlockKind } from '../types';

/** Сборка текста пользователя из блоков и имя файла (SPEC §10). Форматы .docx и сравнение с исходником добавятся в фазе 8. */

export interface ExportBlock {
  paragraphIndex: number;
  kind: BlockKind;
  userText: string;
}

interface Paragraph {
  kind: BlockKind;
  text: string;
}

/**
 * Блоки с одинаковым paragraphIndex склеиваются через пробел, абзацы разделяются пустой строкой.
 * Блок после ручной склейки хранит paragraphIndex первого, так что вышедший из двух абзацев блок попадает в один.
 * Заголовок в .md выводится как `##`, в .txt остаётся обычной строкой. Пункты списка выводятся с маркером «- »,
 * идущие подряд пункты в соседних строках без пустой строки между ними. Пустые блоки пропускаются.
 */
export function assembleText(blocks: ExportBlock[], opts: { markdown?: boolean } = {}): string {
  const paragraphs: Array<Paragraph & { paragraphIndex: number }> = [];
  for (const block of blocks) {
    const text = block.userText.trim();
    if (!text) continue;
    const last = paragraphs[paragraphs.length - 1];
    if (last && last.paragraphIndex === block.paragraphIndex) last.text += ` ${text}`;
    else paragraphs.push({ paragraphIndex: block.paragraphIndex, kind: block.kind, text });
  }

  let out = '';
  paragraphs.forEach((p, i) => {
    const line = p.kind === 'heading' && opts.markdown ? `## ${p.text}` : p.kind === 'list-item' ? `- ${p.text}` : p.text;
    if (i > 0) out += p.kind === 'list-item' && paragraphs[i - 1]!.kind === 'list-item' ? '\n' : '\n\n';
    out += line;
  });
  return out;
}

/** «Тайм-менеджмент и Pomodoro» → «тайм-менеджмент-и-pomodoro». Буквы и цифры любых алфавитов остаются, остальное дефис. */
export function slugify(title: string, maxLength = 60): string {
  const slug = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return slug || 'text';
}

export const exportFileName = (title: string, ext: string) => `${slugify(title)}.${ext}`;
