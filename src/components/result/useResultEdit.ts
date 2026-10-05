import { useEffect, useRef, useState } from 'react';
import { applyEdit, leaveEdit } from '../../lib/resultEdit';
import { canFinish } from '../../lib/session';
import type { Doc } from '../../lib/types';
import { useApp } from '../../store/app';
import type { EditApi } from './Compare';
import type { FieldCounts } from '../session/WritingField';

type Message = 'empty' | 'paste' | 'restored' | null;

export interface ResultEdit {
  on: boolean;
  /** Снимок документа на входе в режим: метрики и проверка не пересчитываются, пока правишь. */
  frozen: Doc | null;
  api: EditApi | undefined;
  restored: boolean;
  start(): void;
  finish(): void;
}

/**
 * Режим правки на Result (SPEC §15.5). Давления нет, блокировка вставки и подсчёт набранного те же, что в Session.
 * Изменения пишутся в Block.userText через updateDoc, то есть автосохранением, как любая правка.
 */
export function useResultEdit(doc: Doc | undefined, allowPaste: boolean, lang: string, onFinished: () => void): ResultEdit {
  const [on, setOn] = useState(false);
  const [frozen, setFrozen] = useState<Doc | null>(null);
  const [field, setField] = useState<{ id: string; start: string; draft: string } | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const live = useRef({ doc, field, onFinished });
  useEffect(() => {
    live.current = { doc, field, onFinished };
  });
  useEffect(() => () => clearTimeout(timer.current), []);

  const flash = (m: Message, ms: number) => {
    clearTimeout(timer.current);
    setMessage(m);
    if (ms > 0) timer.current = setTimeout(() => setMessage(null), ms);
  };

  /** Закрывает открытое поле. Пустой блок возвращается к тексту, с которым поле открыли. */
  const leave = () => {
    const { doc: d, field: f } = live.current;
    if (!d || !f) return;
    if (!canFinish(f.draft)) {
      useApp.getState().updateDoc(d.id, (x) => leaveEdit(x, f.id, f.draft, f.start).doc);
      flash('restored', 6000);
    } else flash(null, 0);
    setField(null);
  };

  const finish = () => {
    leave();
    setOn(false);
    setFrozen(null);
    live.current.onFinished();
  };

  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // finish читает только live
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);

  const api: EditApi | undefined =
    on && doc
      ? {
          activeId: field?.id ?? null,
          draft: field?.draft ?? '',
          lang,
          allowPaste,
          message: message === 'empty' || message === 'paste' ? message : null,
          pick: (id) => {
            if (field?.id === id) return;
            leave();
            const block = doc.blocks.find((b) => b.id === id);
            if (block) setField({ id, start: block.userText, draft: block.userText });
          },
          change: (value: string, counts: FieldCounts) => {
            if (!field) return;
            setField({ ...field, draft: value });
            flash(canFinish(value) ? null : 'empty', 0);
            useApp.getState().updateDoc(doc.id, (d) => applyEdit(d, field.id, value, counts));
          },
          pasteBlocked: () => flash('paste', 4000),
        }
      : undefined;

  return {
    on,
    frozen,
    api,
    restored: message === 'restored',
    start: () => {
      if (!doc) return;
      setFrozen(doc);
      setField(null);
      setMessage(null);
      setOn(true);
    },
    finish,
  };
}
