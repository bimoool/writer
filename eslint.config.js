import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  {
    files: ['**/*.{ts,tsx,js}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2023, globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    // UI-слой: без захардкоженного текста и hex-цветов (CLAUDE.md, правила работы).
    files: ['src/screens/**/*.tsx', 'src/components/**/*.tsx', 'src/App.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXText[value=/[А-Яа-яЁё]/]',
          message: 'Строки интерфейса храним в src/i18n/ru.ts.',
        },
        {
          selector: 'Literal[value=/[А-Яа-яЁё]/]',
          message: 'Строки интерфейса храним в src/i18n/ru.ts.',
        },
        {
          selector: 'Literal[value=/#[0-9a-fA-F]{3,8}\\b/]',
          message: 'Цвета берём только из токенов (src/styles/tokens.css).',
        },
      ],
    },
  },
);
