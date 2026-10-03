import { useEffect, type RefObject } from 'react';

/**
 * Привязывает контейнер к видимой области экрана (visualViewport): экранная клавиатура сжимает её,
 * а на iOS ещё и сдвигает (offsetTop), при этом layout viewport остаётся прежним и fixed-элементы
 * уезжали бы под клавиатуру. Контейнер читает переменные --vv-h и --vv-top.
 * Поворот экрана и сворачивание клавиатуры дают resize; после orientationchange iOS отдаёт
 * размеры с задержкой, поэтому пересчитываем ещё раз.
 */
export function useVisualViewport(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const vv = window.visualViewport;
    let late: ReturnType<typeof setTimeout> | undefined;

    const apply = () => {
      el.style.setProperty('--vv-h', `${vv?.height ?? window.innerHeight}px`);
      el.style.setProperty('--vv-top', `${vv?.offsetTop ?? 0}px`);
    };
    const onOrientation = () => {
      apply();
      clearTimeout(late);
      late = setTimeout(apply, 300);
    };

    apply();
    vv?.addEventListener('resize', apply);
    vv?.addEventListener('scroll', apply);
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', onOrientation);
    return () => {
      clearTimeout(late);
      vv?.removeEventListener('resize', apply);
      vv?.removeEventListener('scroll', apply);
      window.removeEventListener('resize', apply);
      window.removeEventListener('orientationchange', onOrientation);
    };
  }, [ref]);
}
