import { useRef, useState } from 'react';
import { ru } from '../i18n/ru';
import { backupFileName, makeBackup, parseBackup, planImport, serializeBackup } from '../lib/io/backup';
import type { Doc } from '../lib/types';
import { useApp } from '../store/app';
import { downloadText } from './download';

type Notice = { kind: 'info' | 'error'; text: string };

const link =
  'min-h-10 rounded-surface px-2 text-meta text-text-dim transition-colors duration-[120ms] hover:text-text';

/** Резервная копия всех документов: сохранить файл и загрузить обратно. Настройки из файла не применяются. */
export function BackupBar() {
  const input = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [conflicts, setConflicts] = useState<Doc[]>([]);
  const [loaded, setLoaded] = useState(0);

  const save = () => {
    const { docs, settings } = useApp.getState();
    downloadText(backupFileName(), serializeBackup(makeBackup(docs, settings)));
  };

  const report = (count: number, skipped: number) =>
    setNotice({
      kind: 'info',
      text: [ru.home.backup.loaded(count), skipped ? ru.home.backup.skippedBroken(skipped) : ''].filter(Boolean).join('. '),
    });

  const load = async (file: File) => {
    setConflicts([]);
    const parsed = parseBackup(await file.text().catch(() => ''));
    if (!parsed.ok) {
      setNotice({ kind: 'error', text: parsed.error === 'version' ? ru.errors.backupVersion : ru.errors.backupUnreadable });
      return;
    }
    if (parsed.documents.length === 0) {
      setNotice(
        parsed.skipped ? { kind: 'error', text: ru.errors.backupUnreadable } : { kind: 'info', text: ru.home.backup.empty },
      );
      return;
    }
    const { docs, importDocs } = useApp.getState();
    const plan = planImport(docs.map((d) => d.id), parsed.documents);
    if (plan.fresh.length) await importDocs(plan.fresh);
    setLoaded(plan.fresh.length);
    report(plan.fresh.length, parsed.skipped);
    setConflicts(plan.conflicts);
  };

  const replace = async () => {
    await useApp.getState().importDocs(conflicts);
    report(loaded + conflicts.length, 0);
    setConflicts([]);
  };

  return (
    <section className="mt-14">
      <div className="-ml-2 flex flex-wrap gap-x-2">
        <button type="button" onClick={save} className={link}>
          {ru.home.backup.save}
        </button>
        <button type="button" onClick={() => input.current?.click()} className={link}>
          {ru.home.backup.load}
        </button>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          tabIndex={-1}
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void load(file);
          }}
        />
      </div>

      {notice && (
        <p role={notice.kind === 'error' ? 'alert' : 'status'} className={`mt-2 text-meta ${notice.kind === 'error' ? 'text-danger' : 'text-text-dim'}`}>
          {notice.text}
        </p>
      )}

      {conflicts.length > 0 && (
        <div role="group" aria-label={ru.home.backup.conflict(conflicts.length)} className="mt-2">
          <p className="text-meta text-text">{ru.home.backup.conflict(conflicts.length)}</p>
          <div className="mt-1 flex items-center gap-x-3">
            <button type="button" onClick={() => void replace()} className="min-h-10 rounded-surface bg-ink px-4 text-meta font-medium text-bg transition-colors duration-[120ms] hover:bg-ink-hover">
              {ru.home.backup.replace}
            </button>
            <button type="button" onClick={() => setConflicts([])} className={link}>
              {ru.home.backup.skip}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
