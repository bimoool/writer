import { create } from 'zustand';

export type Screen = 'home' | 'split' | 'session' | 'result';
export type Theme = 'dark' | 'light' | 'sepia';

export const THEMES: readonly Theme[] = ['dark', 'light', 'sepia'];

interface AppState {
  screen: Screen;
  theme: Theme;
  go: (screen: Screen) => void;
  setTheme: (theme: Theme) => void;
}

/** Навигация между экранами без роутера и текущая тема. Настройки начнут сохраняться в фазе 2. */
export const useApp = create<AppState>((set) => ({
  screen: 'home',
  theme: 'dark',
  go: (screen) => set({ screen }),
  setTheme: (theme) => set({ theme }),
}));
