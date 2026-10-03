import { extractKeyphrases } from './keywords';
import { DEFAULT_DELAY_SEC, clampDelaySec } from './pressure';
import { segment } from './segment';
import { detectLang, tokenize } from './tokens';
import type { Block, BlockHints, BlockSize, Doc, Settings } from './types';

export type DocScreen = 'split' | 'session' | 'result';

/** Создание документа и значения по умолчанию (SPEC §4). */

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  defaultBlockSize: 'medium',
  pressure: 'off',
  pressureDelaySec: DEFAULT_DELAY_SEC,
  allowPaste: false,
  writingFont: 'serif',
};

const TITLE_WORDS = 6;

export const emptyHints = (): BlockHints => ({ maxLevel: 0, opens: { 1: 0, 2: 0, 3: 0 }, peeks: 0, peekMs: 0 });

/** Название: первые 6 слов исходника (SPEC §3.1), без завершающей пунктуации. */
export function titleFromSource(source: string): string {
  // Заголовок «# …» берётся отдельно, обычный первый абзац склеивается в одну строку.
  const paragraph = source.trim().split(/\n\s*\n/)[0] ?? '';
  const lines = paragraph.split('\n');
  const head = /^\s*#/.test(lines[0] ?? '') ? lines[0]!.replace(/^\s*#+\s*/, '') : lines.join(' ');
  const tokens = tokenize(head).slice(0, TITLE_WORDS);
  if (tokens.length === 0) return '';
  return head.slice(tokens[0]!.start, tokens[tokens.length - 1]!.end);
}

/** Имя файла без расширения: «pomodoro-notes.docx» → «pomodoro-notes». */
export const titleFromFileName = (name: string) => name.replace(/\.[^.]+$/, '').trim();

export interface CreateDocOptions {
  title?: string;
  blockSize?: BlockSize;
  now?: number;
  newId?: () => string;
}

/** Разбивает текст на блоки и считает ключевые фразы. */
export function buildBlocks(source: string, size: BlockSize, newId: () => string): Block[] {
  const lang = detectLang(source);
  const segments = segment(source, size, lang);
  const phrases = extractKeyphrases(
    segments.map((s) => ({ text: s.text, kind: s.kind })),
    lang,
  );
  return segments.map((s, i) => ({
    id: newId(),
    paragraphIndex: s.paragraphIndex,
    kind: s.kind,
    sourceText: s.text,
    keyphrases: phrases[i]!,
    userText: '',
    status: 'pending',
    hints: emptyHints(),
    typedChars: 0,
    pastedChars: 0,
    activeMs: 0,
  }));
}

export function createDoc(source: string, opts: CreateDocOptions = {}): Doc {
  const now = opts.now ?? Date.now();
  const newId = opts.newId ?? (() => crypto.randomUUID());
  const blockSize = opts.blockSize ?? DEFAULT_SETTINGS.defaultBlockSize;
  return {
    id: newId(),
    title: opts.title?.trim() || titleFromSource(source),
    source,
    blockSize,
    manualEdits: false,
    blocks: buildBlocks(source, blockSize, newId),
    currentIndex: 0,
    createdAt: now,
    updatedAt: now,
  };
}

/** Прогресс для списка документов: сколько блоков завершено. */
export const doneCount = (doc: Doc) => doc.blocks.filter((b) => b.status === 'done').length;

export const isFinished = (doc: Doc) =>
  doc.finishedAt !== undefined || (doc.blocks.length > 0 && doneCount(doc) === doc.blocks.length);

/** Куда ведёт «Продолжить»: итог для готового, сессия для начатого, разбивка для нового. */
export function screenForDoc(doc: Doc): DocScreen {
  if (isFinished(doc)) return 'result';
  return doc.blocks.some((b) => b.status !== 'pending') ? 'session' : 'split';
}

const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  typeof value === 'string' && (options as readonly string[]).includes(value) ? (value as T) : fallback;

/** Приводит что угодно (запись из БД, поле резервной копии) к корректным настройкам. */
export function normalizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  return {
    theme: oneOf(r.theme, ['dark', 'light', 'sepia'], d.theme),
    defaultBlockSize: oneOf(r.defaultBlockSize, ['short', 'medium', 'long'], d.defaultBlockSize),
    pressure: oneOf(r.pressure, ['off', 'soft', 'kamikaze'], d.pressure),
    pressureDelaySec: typeof r.pressureDelaySec === 'number' ? clampDelaySec(r.pressureDelaySec) : d.pressureDelaySec,
    allowPaste: typeof r.allowPaste === 'boolean' ? r.allowPaste : d.allowPaste,
    writingFont: oneOf(r.writingFont, ['serif', 'mono'], d.writingFont),
  };
}
