import { normalizeSettings } from '../doc';
import type { Block, Doc, Settings } from '../types';

/** Резервная копия всех документов (SPEC §10). */

export const BACKUP_APP = 'svoimi';
export const BACKUP_VERSION = 1;

export interface Backup {
  app: typeof BACKUP_APP;
  version: typeof BACKUP_VERSION;
  exportedAt: number;
  documents: Doc[];
  settings: Settings;
}

export type BackupError = 'json' | 'format' | 'version';

export type ParsedBackup =
  | { ok: true; documents: Doc[]; settings: Settings; skipped: number }
  | { ok: false; error: BackupError };

export function makeBackup(documents: Doc[], settings: Settings, now = Date.now()): Backup {
  return { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: now, documents, settings };
}

export const serializeBackup = (b: Backup) => JSON.stringify(b);

export function backupFileName(now = Date.now()): string {
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `svoimi-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

function isBlock(v: unknown): v is Block {
  if (!isObj(v)) return false;
  const h = v.hints;
  return (
    isStr(v.id) &&
    isNum(v.paragraphIndex) &&
    ['text', 'heading', 'list-item'].includes(v.kind as string) &&
    isStr(v.sourceText) &&
    Array.isArray(v.keyphrases) &&
    v.keyphrases.every((k) => isObj(k) && isNum(k.start) && isNum(k.end)) &&
    isStr(v.userText) &&
    ['pending', 'writing', 'done'].includes(v.status as string) &&
    isObj(h) &&
    isNum(h.maxLevel) &&
    isObj(h.opens) &&
    isNum(h.opens[1]) &&
    isNum(h.opens[2]) &&
    isNum(h.opens[3]) &&
    isNum(h.peeks) &&
    isNum(h.peekMs) &&
    isNum(v.typedChars) &&
    isNum(v.pastedChars) &&
    isNum(v.activeMs)
  );
}

export function isDoc(v: unknown): v is Doc {
  return (
    isObj(v) &&
    isStr(v.id) &&
    v.id.length > 0 &&
    isStr(v.title) &&
    isStr(v.source) &&
    ['short', 'medium', 'long'].includes(v.blockSize as string) &&
    typeof v.manualEdits === 'boolean' &&
    Array.isArray(v.blocks) &&
    v.blocks.every(isBlock) &&
    isNum(v.currentIndex) &&
    isNum(v.createdAt) &&
    isNum(v.updatedAt) &&
    (v.finishedAt === undefined || isNum(v.finishedAt))
  );
}

/** Разбор файла копии. Битые документы пропускаются и считаются в skipped, а не роняют весь импорт. */
export function parseBackup(text: string): ParsedBackup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'json' };
  }
  if (!isObj(data) || data.app !== BACKUP_APP || !Array.isArray(data.documents)) return { ok: false, error: 'format' };
  if (data.version !== BACKUP_VERSION) return { ok: false, error: 'version' };
  const documents = data.documents.filter(isDoc);
  return {
    ok: true,
    documents,
    settings: normalizeSettings(data.settings),
    skipped: data.documents.length - documents.length,
  };
}

export interface ImportPlan {
  /** Документы с новыми id: добавляются без вопросов. */
  fresh: Doc[];
  /** Совпали по id с уже существующими: пользователь решает, заменить или пропустить. */
  conflicts: Doc[];
}

export function planImport(existingIds: Iterable<string>, incoming: Doc[]): ImportPlan {
  const ids = new Set(existingIds);
  const fresh: Doc[] = [];
  const conflicts: Doc[] = [];
  const seen = new Set<string>();
  for (const d of incoming) {
    if (seen.has(d.id)) continue; // дубль внутри самого файла: берём первый
    seen.add(d.id);
    (ids.has(d.id) ? conflicts : fresh).push(d);
  }
  return { fresh, conflicts };
}

export type ConflictDecision = 'replace' | 'skip';

/** Какие документы записать: новые плюс конфликтные, для которых выбрано «заменить». */
export function resolveImport(plan: ImportPlan, decide: (doc: Doc) => ConflictDecision): Doc[] {
  return [...plan.fresh, ...plan.conflicts.filter((d) => decide(d) === 'replace')];
}
