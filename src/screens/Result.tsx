import { useEffect, useMemo, useRef, useState } from 'react';
import { downloadText } from '../components/download';
import { ru } from '../i18n/ru';
import { frontierIndex } from '../lib/session';
import { assembleText, exportFileName } from '../lib/io/export';
import { useApp } from '../store/app';

const primary =
  'min-h-12 rounded-surface bg-ink px-6 text-ui font-medium text-bg transition-colors duration-[120ms] hover:bg-ink-hover';
const quiet = 'min-h-12 rounded-surface px-3 text-ui text-text-dim transition-colors duration-[120ms] hover:text-text';

/** Копирование. Clipboard API есть только в защищённом контексте (https), на обычном http работает запасной путь. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
    document.body.append(el);
    el.select();
    const ok = document.execCommand('copy');
    el.remove();
    return ok;
  }
}

/** Временная версия Result: текст пользователя и три кнопки. Метрики, сравнение с исходником и .docx в фазе 8. */
export function Result() {
  const doc = useApp((s) => s.docs.find((d) => d.id === s.currentDocId));
  const [notice, setNotice] = useState<'copied' | 'failed' | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const finished = !!doc && frontierIndex(doc) >= doc.blocks.length;
  useEffect(() => {
    if (!doc) useApp.getState().go('home');
    else if (!finished) useApp.getState().go('session');
  }, [doc, finished]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const text = useMemo(() => (doc ? assembleText(doc.blocks) : ''), [doc]);
  if (!doc || !finished) return null;

  const copy = async () => {
    clearTimeout(timer.current);
    setNotice((await copyText(text)) ? 'copied' : 'failed');
    timer.current = setTimeout(() => setNotice(null), 3000);
  };

  return (
    <main className="mx-auto w-full max-w-[44rem] px-4 pb-20 pt-10">
      <h1 className="font-serif text-h1 text-text">{ru.result.title}</h1>

      <div className="-ml-3 mt-5 flex flex-wrap items-center gap-x-2">
        <button type="button" className={`${primary} ml-3`} onClick={() => void copy()}>
          {ru.result.copy}
        </button>
        <button type="button" className={quiet} onClick={() => downloadText(exportFileName(doc.title, 'txt'), `${text}\n`, 'text/plain')}>
          {ru.result.downloadTxt}
        </button>
        <button type="button" className={quiet} onClick={() => useApp.getState().openDocument(null, 'home')}>
          {ru.result.home}
        </button>
      </div>
      <p role="status" className="mt-2 min-h-5 text-meta text-text-dim">
        {notice === 'copied' ? ru.result.copied : notice === 'failed' ? ru.result.copyFailed : ''}
      </p>

      <div className="reading-column mt-6 max-w-none text-text">
        {text.split('\n\n').map((paragraph, i) => (
          <p key={i} className="mb-4 whitespace-pre-wrap [overflow-wrap:anywhere]">
            {paragraph}
          </p>
        ))}
      </div>
    </main>
  );
}
