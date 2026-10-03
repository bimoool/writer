import { useEffect } from 'react';
import { ThemeSwitcher } from './components/ThemeSwitcher';
import { ru } from './i18n/ru';
import { Home } from './screens/Home';
import { Result } from './screens/Result';
import { Session } from './screens/Session';
import { Split } from './screens/Split';
import { useApp } from './store/app';

const SCREENS = { home: Home, split: Split, session: Session, result: Result } as const;

export function App() {
  const screen = useApp((s) => s.screen);
  const theme = useApp((s) => s.theme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const Current = SCREENS[screen];

  return (
    <div className="min-h-dvh bg-bg text-text">
      <header className="flex items-center justify-between px-4 py-2">
        <span className="text-ui font-medium">{ru.appName}</span>
        <ThemeSwitcher />
      </header>
      <Current />
    </div>
  );
}
