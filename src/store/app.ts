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
  /** Открыта панель настроек (модальное окно; в сессии ставит давление на паузу). */
  settingsOpen: boolean;
  /** Сервис открыли в другой вкладке: эта больше ничего не пишет (tabLock.ts). */
  locked: boolean;

  hydrate(): Promise<void>;
  go(screen: Screen): void;
  setSettings(patch: Partial<Settings>): void;
  setTheme(theme: Theme): void;
  setSettingsOpen(open: boolean): void;
  createDocument(source: string, opts?: Omit<CreateDocOptions, 'now' | 'newId'>): Doc;
  /** Делает документ текущим и, если указан экран, переходит на него. */
  openDocument(id: string | null, screen?: Screen): void;
  /** Любое изменение документа идёт через эту функцию: она ставит updatedAt и автосохранение. */
  updateDoc(id: string, change: (doc: Doc) => Doc): void;
  renameDoc(id: string, title: string): void;
  deleteDoc(id: string): Promise<void>;
  /** Записывает документы из резервной копии. Настройки из копии не применяются. */
  importDocs(docs: Doc[]): Promise<void>;
  flush(): Promise<void>;
  /** Отдать документы другой вкладке: сразу перестать писать, дописать очередь и остановить автосохранение. */
  lock(): Promise<void>;
}

let repo: Repo | null = null;
let saver: Autosaver<Doc> | null = null;
/** Вкладка отдала документы другой: любые записи отсюда затёрли бы более новый текст. */
let frozen = false;

const sortDocs = (docs: Doc[]) => [...docs].sort((a, b) => b.updatedAt - a.updatedAt);

function readRescue(): Doc[] {
  try {
    const raw = localStorage.getItem(RESCUE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    // Повреждённый снимок не должен ломать загрузку: берём только то, что похоже на документ.
    return Array.isArray(parsed)
      ? (parsed as Doc[]).filter((d) => d && typeof d.id === 'string' && typeof d.updatedAt === 'number' && Array.isArray(d.blocks))
      : [];
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
    if (frozen) return;
    const { screen, currentDocId } = get();
    repo?.saveSession({ screen, currentDocId }).catch(fail);
  };

  return {
    ready: false,
    screen: 'home',
    settings: DEFAULT_SETTINGS,
    docs: [],
    currentDocId: null,
    settingsOpen: false,
    locked: false,
    saveError: null,

    async hydrate() {
      try {
        if (!repo) throw Object.assign(new Error('Хранилище не подключено'), { name: 'MissingAPIError' });
        const [stored, settings, session] = await Promise.all([repo.loadDocs(), repo.loadSettings(), repo.loadSession()]);
        const { merged, restored } = pickNewer(stored, readRescue());
        const currentDocId = session?.currentDocId && merged.some((d) => d.id === session.currentDocId) ? session.currentDocId : null;
        set({
          ready: true,
          docs: sortDocs(merged),
          settings,
          currentDocId,
          screen: currentDocId ? (session?.screen ?? 'home') : 'home',
        });
        // Восстановленное из снимка идёт через автосохранение: если запись снова упадёт (например, место кончилось),
        // документы останутся в памяти и в очереди, а снимок сотрётся только после успешной записи (onSaved).
        if (restored.length && saver) {
          for (const d of restored) saver.schedule(d);
          await saver.flush();
        } else clearRescue();
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
      if (frozen) return;
      const settings = { ...get().settings, ...patch };
      set({ settings });
      repo?.saveSettings(settings).then(() => set({ saveError: null }), fail);
    },

    setTheme(theme) {
      get().setSettings({ theme });
    },

    setSettingsOpen(open) {
      set({ settingsOpen: open });
    },

    createDocument(source, opts = {}) {
      const doc = createDoc(source, { blockSize: get().settings.defaultBlockSize, ...opts });
      if (frozen) return doc;
      set({ docs: [doc, ...get().docs], currentDocId: doc.id });
      saver?.schedule(doc);
      persistSession();
      return doc;
    },

    openDocument(id, screen) {
      set({ currentDocId: id, ...(screen ? { screen } : {}) });
      persistSession();
    },

    updateDoc(id, change) {
      if (frozen) return;
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
      if (frozen) return;
      saver?.cancel(id);
      const wasCurrent = get().currentDocId === id;
      set({ docs: get().docs.filter((d) => d.id !== id), ...(wasCurrent ? { currentDocId: null, screen: 'home' } : {}) });
      if (wasCurrent) persistSession();
      await repo?.deleteDoc(id).catch(fail);
    },

    async importDocs(docs) {
      if (frozen) return;
      const ids = new Set(docs.map((d) => d.id));
      set({ docs: sortDocs([...get().docs.filter((d) => !ids.has(d.id)), ...docs]) });
      // Через автосохранение: версия из копии вытесняет несохранённые правки того же документа, а при ошибке записи
      // остаётся в очереди (повтор и аварийный снимок), а не пропадает молча.
      for (const d of docs) saver?.schedule(d);
      await saver?.flush();
    },

    flush: () => saver?.flush() ?? Promise.resolve(),

    async lock() {
      frozen = true;
      set({ locked: true, settingsOpen: false });
      try {
        await saver?.flush();
      } finally {
        // Повторные попытки после ошибки записали бы старую версию поверх работы в другой вкладке.
        saver?.dispose();
      }
    },
  };
});

/** Подключает хранилище к стору. В тестах сюда передаётся БД на fake-indexeddb. */
export function connectStore(r: Repo, opts: { delayMs?: number } = {}): void {
  saver?.dispose();
  frozen = false;
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
