import { useEffect, useMemo, useState } from 'react';
import { ru } from '../../i18n/ru';
import type { Block } from '../../lib/types';
import {
  cachedSourceTemplates,
  SYNC_SOURCE_CHARS,
  sourceChars,
  sourceTemplatesAsync,
  sourceTemplatesFor,
  spotsByBlock,
  type SourceTemplates,
  type TemplateSpot,
} from '../../lib/sourceTemplates';

/** Начало расчёта большого исходника откладывается, чтобы первая отрисовка блоков прошла без него. */
const START_DELAY_MS = 150;

interface Props {
  docId: string;
  blocks: Block[];
  /** Подсветка по блокам, когда переключатель включён; иначе null. */
  onShow: (spots: Map<string, TemplateSpot[]> | null) => void;
}

/**
 * Строка-сводка шаблонов исходника над блоками Split (SPEC §15.7). Небольшой исходник считается сразу; большой порциями,
 * и пока идёт расчёт в строке «Считаем…». Расчёт и его состояние живут здесь, а не в Split: окончание расчёта
 * не перерисовывает список из сотен блоков.
 */
export function TemplatesBar({ docId, blocks, onShow }: Props) {
  const [show, setShow] = useState(false);
  const [late, setLate] = useState<{ blocks: Block[]; value: SourceTemplates } | null>(null);
  const templates = useMemo(() => {
    if (sourceChars(blocks) <= SYNC_SOURCE_CHARS) return sourceTemplatesFor(docId, blocks);
    return cachedSourceTemplates(docId, blocks) ?? (late?.blocks === blocks ? late.value : null);
  }, [docId, blocks, late]);
  const pending = !templates;

  useEffect(() => {
    if (!pending) return;
    const abort = new AbortController();
    // Пауза, чтобы экран успел отрисоваться и расчёт не вклинился в первую отрисовку сотен блоков.
    const timer = setTimeout(() => {
      sourceTemplatesAsync(docId, blocks, abort.signal).then(
        (value) => setLate({ blocks, value }),
        () => undefined,
      );
    }, START_DELAY_MS);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [pending, docId, blocks]);

  useEffect(() => {
    onShow(templates && show ? spotsByBlock(templates, blocks) : null);
  }, [templates, show, blocks, onShow]);

  if (!templates) {
    return (
      <p role="status" data-templates="counting" className="mt-2 text-meta text-text-dim">
        {ru.split.templates.counting}
      </p>
    );
  }
  const c = templates.counts;
  return (
    <div aria-label={ru.split.templates.label} role="group" data-templates="ready" className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-meta text-text-dim">
      {c.total === 0 ? (
        <p role="status">{ru.split.templates.none}</p>
      ) : (
        <>
          <p role="status">
            {ru.split.templates.found(c.total)} (<span className="tpl-cliche">{ru.split.templates.cliche}</span> {c.cliche},{' '}
            <span className="tpl-junk">{ru.split.templates.junk}</span> {c.junk}, <span className="tpl-rhythm">{ru.split.templates.rhythm}</span> {c.rhythm})
          </p>
          <button
            type="button"
            aria-pressed={show}
            onClick={() => setShow(!show)}
            className={`min-h-10 rounded-surface px-2 text-meta transition-colors duration-[120ms] hover:text-text ${show ? 'bg-surface text-text' : ''}`}
          >
            {ru.split.templates.toggle}
          </button>
        </>
      )}
    </div>
  );
}
