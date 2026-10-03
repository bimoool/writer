import { useLayoutEffect, useRef } from 'react';

const GAP_PX = 12;

/**
 * Уже написанное: приглушённо, над полем письма (DESIGN §5). Видны последние два блока,
 * остальное доступно прокруткой вверх.
 */
export function PreviousText({ texts }: { texts: string[] }) {
  const box = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      const kids = [...el.children].slice(-2) as HTMLElement[];
      el.style.setProperty('--prev-h', `${kids.reduce((sum, k) => sum + k.offsetHeight + GAP_PX, 0)}px`);
      el.scrollTop = el.scrollHeight;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [texts]);

  if (texts.length === 0) return null;
  return (
    <div ref={box} className="prev-text reading-column mb-3 max-w-none text-text-ghost">
      {texts.map((t, i) => (
        <p key={i} className="whitespace-pre-wrap [overflow-wrap:anywhere]" style={{ marginBottom: GAP_PX }}>
          {t}
        </p>
      ))}
    </div>
  );
}
