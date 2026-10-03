import { create } from 'zustand';
import { createAutosaver, pickNewer, type Autosaver } from '../lib/autosave';
import { DEFAULT_SETTINGS, createDoc, type CreateDocOptions } from '../lib/doc';
import type { Doc, Settings } from '../lib/types';
import { classifyDbError, type DbErrorKind, type Repo } from './db';

export type Screen = 'home' | 'split' | 'session' | 'result';
export type Theme = Settings['theme'];

export const THEMES: readonly Theme[] = ['dark', 'light', 'sepia'];

const RESCUE_KEY = 'svoimi:rescue';

interface AppState {
  ready: boolean;
  screen: Screen;
  settings: Settings;
  /** Все документы, свежие сверху. */
  docs: Doc[];
  currentDocId: string | null;
  /** Последняя ошибка записи в IndexedDB; null, когда всё сохранено. */
  saveError: DbErrorKind | null;

  hydrate(): Promise<void>;
  go(screen: Screen): void;
  setSettings(patch: Partial<Settings>): void;
  setTheme(theme: Theme): void;
  createDocument(source: string, opts?: Omit<CreateDocOptions, 'now' | 'newId'>): Doc;
  openDocument(id: string | null): void;
  /** Любое изменение документа идёт через эту функцию: она ставит updatedAt и автосохранение. */
  updateDoc(id: string, change: (doc: Doc) => Doc): void;
  renameDoc(id: string, title: string): void;
  deleteDoc(id: string): Promise<void>;
  /** Записывает документы (импорт резервной копии) и применяет настройки из неё. */
  importDocs(docs: Doc[], settings?: Settings): Promise<void>;
  flush(): Promise<void>;
}

let repo: Repo | null = null;
let saver: Autosaver<Doc> | null = null;

const sortDocs = (docs: Doc[]) => [...docs].sort((a, b) => b.updatedAt - a.updatedAt);

function readRescue(): Doc[] {
  try {
    const raw = localStorage.getItem(RESCUE_KEY);
    return raw ? (JSON.parse(raw) as Doc[]) : [];
  } catch {
    return [];
  }
}

/** Синхронный аварийный снимок несохранённых документов на случай закрытия вкладки. */
export function writeRescue(): void {
  const pending = saver?.pending() ?? [];
  try {
    if (pending.length) localStorage.setItem(RESCUE_KEY, JSON.stringify(pending));
  } catch {
    // localStorage переполнен или недоступен: остаётся только запись в IndexedDB, которая уже запущена.
  }
}

const clearRescue = () => {
  try {
    localStorage.removeItem(RESCUE_KEY);
  } catch {
    /* недоступен */
  }
};

export const useApp = create<AppState>((set, get) => {
  const fail = (e: unknown) => {
    console.error(e);
    set({ saveError: classifyDbError(e) });
  };
  const persistSession = () => {
    const { screen, currentDocId } = get();
    repo?.saveSession({ screen, currentDocId }).catch(fail);
  };

  return {
    ready: false,
    screen: 'home',
    settings: DEFAULT_SETTINGS,
    docs: [],
    currentDocId: null,
    saveError: null,

    async hydrate() {
      try {
        if (!repo) throw Object.assign(new Error('Хранилище не подключено'), { name: 'MissingAPIError' });
        const [stored, settings, session] = await Promise.all([repo.loadDocs(), repo.loadSettings(), repo.loadSession()]);
        const { merged, restored } = pickNewer(stored, readRescue());
        if (restored.length) await repo.saveDocs(restored);
        clearRescue();
        const currentDocId = session?.currentDocId && merged.some((d) => d.id === session.currentDocId) ? session.currentDocId : null;
        set({
          ready: true,
          docs: sortDocs(merged),
          settings,
          currentDocId,
          screen: currentDocId ? (session?.screen ?? 'home') : 'home',
        });
      } catch (e) {
        // Без IndexedDB приложение работает в памяти и честно предупреждает, что ничего не сохранится.
        fail(e);
        set({ ready: true });
      }
    },

    go(screen) {
      set({ screen });
      persistSession();
    },

    setSettings(patch) {
      const settings = { ...get().settings, ...patch };
      set({ settings });
      repo?.saveSettings(settings).then(() => set({ saveError: null }), fail);
    },

    setTheme(theme) {
      get().setSettings({ theme });
    },

    createDocument(source, opts = {}) {
      const doc = createDoc(source, { blockSize: get().settings.defaultBlockSize, ...opts });
      set({ docs: [doc, ...get().docs], currentDocId: doc.id });
      saver?.schedule(doc);
      persistSession();
      return doc;
    },

    openDocument(id) {
      set({ currentDocId: id });
      persistSession();
    },

    updateDoc(id, change) {
      const old = get().docs.find((d) => d.id === id);
      if (!old) return;
      const doc = { ...change(old), id, updatedAt: Date.now() };
      set({ docs: sortDocs(get().docs.map((d) => (d.id === id ? doc : d))) });
      saver?.schedule(doc);
    },

    renameDoc(id, title) {
      const t = title.trim();
      if (t) get().updateDoc(id, (d) => ({ ...d, title: t }));
    },

    async deleteDoc(id) {
      saver?.cancel(id);
      const wasCurrent = get().currentDocId === id;
      set({ docs: get().docs.filter((d) => d.id !== id), ...(wasCurrent ? { currentDocId: null, screen: 'home' } : {}) });
      if (wasCurrent) persistSession();
      await repo?.deleteDoc(id).catch(fail);
    },

    async importDocs(docs, settings) {
      const ids = new Set(docs.map((d) => d.id));
      set({ docs: sortDocs([...get().docs.filter((d) => !ids.has(d.id)), ...docs]) });
      if (settings) get().setSettings(settings);
      for (const d of docs) saver?.cancel(d.id);
      await repo?.saveDocs(docs).then(() => set({ saveError: null }), fail);
    },

    flush: () => saver?.flush() ?? Promise.resolve(),
  };
});

/** Подключает хранилище к стору. В тестах сюда передаётся БД на fake-indexeddb. */
export function connectStore(r: Repo, opts: { delayMs?: number } = {}): void {
  saver?.dispose();
  repo = r;
  saver = createAutosaver<Doc>({
    save: (docs) => r.saveDocs(docs),
    getId: (d) => d.id,
    delayMs: opts.delayMs,
    onSaved: () => {
      if (!saver?.hasPending()) clearRescue();
      useApp.setState({ saveError: null });
    },
    onError: (e) => {
      console.error(e);
      useApp.setState({ saveError: classifyDbError(e) });
    },
  });
}

export const hasUnsaved = () => saver?.hasPending() ?? false;
