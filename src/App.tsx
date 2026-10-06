import { useEffect } from 'react';
import { SaveErrorNotice } from './components/SaveErrorNotice';
import { SettingsPanel } from './components/SettingsPanel';
import { TabLockedNotice } from './components/TabLockedNotice';
import { ru } from './i18n/ru';
import { Home } from './screens/Home';
import { Result } from './screens/Result';
import { Session } from './screens/Session';
import { Split } from './screens/Split';
import { useApp } from './store/app';

const THEME_CACHE_KEY = 'svoimi:theme';
const SCREENS = { home: Home, split: Split, session: Session, result: Result } as const;

export function App() {
  const screen = useApp((s) => s.screen);
  const theme = useApp((s) => s.settings.theme);
  const ready = useApp((s) => s.ready);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_CACHE_KEY, theme);
    } catch {
      // без кэша темы просто возможна короткая вспышка тёмной темы при запуске
    }
  }, [theme]);

  const Current = SCREENS[screen];

  return (
    <div className="min-h-dvh bg-bg text-text">
      {/* В сессии шапка закрыта её слоем и не нужна; из порядка Tab она тоже убрана. */}
      <header hidden={screen === 'session'} className="flex items-center justify-between gap-2 px-4 py-2">
        <button
          type="button"
          onClick={() => useApp.getState().openDocument(null, 'home')}
          className="-ml-2 min-h-10 rounded-surface px-2 text-ui font-medium transition-colors duration-[120ms] hover:text-ink"
        >
          {ru.appName}
        </button>
        {/* До загрузки настроек из базы панель не открываем: выбор перезаписали бы загруженные настройки.
            Кнопка невидима, но место держит, чтобы шапка не прыгала. */}
        <button
          type="button"
          aria-haspopup="dialog"
          disabled={!ready}
          onClick={() => useApp.getState().setSettingsOpen(true)}
          className={`-mr-2 min-h-10 rounded-surface px-2 text-meta text-text-dim transition-colors duration-[120ms] hover:text-text ${ready ? '' : 'invisible'}`}
        >
          {ru.settings.open}
        </button>
      </header>
      {screen !== 'session' && <SaveErrorNotice />}
      {ready && <Current />}
      <SettingsPanel />
      <TabLockedNotice />
    </div>
  );
}
