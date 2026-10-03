import { ru } from '../i18n/ru';
import { THEMES, useApp } from '../store/app';

/** Временный переключатель тем (фаза 0). Тема сохраняется в настройках. В фазе 9 переедет в панель настроек. */
export function ThemeSwitcher() {
  const theme = useApp((s) => s.settings.theme);
  const setTheme = useApp((s) => s.setTheme);

  return (
    <div role="radiogroup" aria-label={ru.theme.label} className="flex gap-1">
      {THEMES.map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={theme === t}
          onClick={() => setTheme(t)}
          className={`min-h-10 rounded-surface px-3 text-meta transition-colors duration-[120ms] ${
            theme === t ? 'text-text' : 'text-text-dim hover:text-text'
          }`}
        >
          {ru.theme[t]}
        </button>
      ))}
    </div>
  );
}
