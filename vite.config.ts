/// <reference types="vitest/config" />
import { execFileSync } from 'node:child_process';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/** Кладёт в dist/version.txt полный хеш коммита, из которого собрана выкладка. Без git сборка падает, а не выпускает файл без версии. */
function versionFile(): Plugin {
  return {
    name: 'version-file',
    apply: 'build',
    generateBundle() {
      const hash = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      this.emitFile({ type: 'asset', fileName: 'version.txt', source: `${hash}\n` });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), versionFile()],
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
