import Dexie, { type EntityTable } from 'dexie';
import { normalizeSettings } from '../lib/doc';
import type { Doc, Settings } from '../lib/types';
import type { Screen } from './app';

/** IndexedDB через Dexie (SPEC §4): документ целиком одной записью и таблица настроек. */

export interface SessionPointer {
  screen: Screen;
  currentDocId: string | null;
}

interface KV {
  key: 'settings' | 'session';
  value: unknown;
}

export type SvoimiDB = Dexie & {
  docs: EntityTable<Doc, 'id'>;
  settings: EntityTable<KV, 'key'>;
};

export function openDb(name = 'svoimi'): SvoimiDB {
  const db = new Dexie(name) as SvoimiDB;
  db.version(1).stores({ docs: 'id, updatedAt', settings: 'key' });
  return db;
}

export type DbErrorKind = 'quota' | 'unavailable' | 'unknown';

/** Человеческая категория ошибки IndexedDB для сообщения в интерфейсе. */
export function classifyDbError(error: unknown): DbErrorKind {
  const names: string[] = [];
  let e: unknown = error;
  for (let i = 0; i < 4 && e && typeof e === 'object'; i++) {
    const { name, inner } = e as { name?: unknown; inner?: unknown };
    if (typeof name === 'string') names.push(name);
    e = inner;
  }
  if (names.includes('QuotaExceededError')) return 'quota';
  if (names.some((n) => ['MissingAPIError', 'OpenFailedError', 'InvalidStateError', 'SecurityError', 'DatabaseClosedError'].includes(n)))
    return 'unavailable';
  return 'unknown';
}

export function createRepo(db: SvoimiDB) {
  return {
    loadDocs: () => db.docs.orderBy('updatedAt').reverse().toArray(),
    saveDocs: (docs: Doc[]) => db.docs.bulkPut(docs).then(() => undefined),
    deleteDoc: (id: string) => db.docs.delete(id),
    async loadSettings(): Promise<Settings> {
      return normalizeSettings((await db.settings.get('settings'))?.value);
    },
    saveSettings: (s: Settings) => db.settings.put({ key: 'settings', value: s }).then(() => undefined),
    async loadSession(): Promise<SessionPointer | null> {
      const v = (await db.settings.get('session'))?.value as Partial<SessionPointer> | undefined;
      if (!v) return null;
      const screen = ['home', 'split', 'session', 'result'].includes(v.screen as string) ? (v.screen as Screen) : 'home';
      return { screen, currentDocId: typeof v.currentDocId === 'string' ? v.currentDocId : null };
    },
    saveSession: (p: SessionPointer) => db.settings.put({ key: 'session', value: p }).then(() => undefined),
  };
}

export type Repo = ReturnType<typeof createRepo>;
