import { createRepo, openDb } from './db';
import { connectStore, useApp, writeRescue } from './app';

/**
 * Запуск хранилища в браузере. Автосохранение срабатывает по debounce, а при уходе со страницы:
 * - visibilitychange → hidden и pagehide: асинхронный flush в IndexedDB (обычно успевает);
 * - beforeunload и pagehide: синхронный снимок несохранённого в localStorage на случай,
 *   если браузер оборвёт транзакцию IndexedDB. При следующем запуске снимок сливается с БД.
 */
export function startPersistence(): void {
  connectStore(createRepo(openDb()));

  const leave = () => {
    writeRescue();
    void useApp.getState().flush();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') leave();
  });
  window.addEventListener('pagehide', leave);
  window.addEventListener('beforeunload', leave);

  void useApp.getState().hydrate();
}
