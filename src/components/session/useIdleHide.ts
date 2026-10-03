import { useEffect, useState } from 'react';

/**
 * Верхняя панель во время письма (DESIGN §4): исчезает через delay мс без движения мыши или касаний,
 * возвращается при движении, касании и фокусе (Tab). Набор текста панель не показывает.
 * Возвращает true, когда панель должна быть видна.
 */
export function useIdleHide(active: boolean, delay = 1500): boolean {
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), delay);
    };
    const wake = () => {
      setIdle(false);
      arm();
    };
    arm();
    const events = ['pointermove', 'pointerdown', 'touchstart', 'focusin'] as const;
    for (const e of events) window.addEventListener(e, wake, { passive: true });
    return () => {
      clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, wake);
    };
  }, [active, delay]);

  return !(active && idle);
}
