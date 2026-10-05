/// <reference lib="webworker" />
import nspell from 'nspell';
// Относительный путь: поле exports пакета не отдаёт файлы словаря по имени пакета. Строки уходят в отдельный чанк воркера.
import aff from '../../node_modules/dictionary-ru/index.aff?raw';
import dic from '../../node_modules/dictionary-ru/index.dic?raw';
import { misspelled, rankSuggestions } from './spell';
import type { SpellRequest, SpellResponse } from './spellClient';

/** Воркер орфографии. Создаётся только после нажатия «Проверить текст»; словарь разворачивается здесь, а не в основном потоке. */

const post = (m: SpellResponse) => self.postMessage(m);
const checker = nspell({ aff, dic });
post({ type: 'ready' });

self.onmessage = (e: MessageEvent<SpellRequest>) => {
  const msg = e.data;
  if (msg.type === 'check') post({ type: 'checked', id: msg.id, bad: misspelled(msg.words, (w) => checker.correct(w)) });
  else post({ type: 'suggested', id: msg.id, suggestions: rankSuggestions(msg.word, checker.suggest(msg.word)) });
};
