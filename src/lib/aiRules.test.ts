import { describe, expect, it } from 'vitest';
import { findPatterns } from './aiCheck';
import { buildCheckText } from './checkText';

/** Короткие выдержки (до 20 слов) для правил, добавленных калибровкой (SPEC §15.6). Целых ИИ-текстов в тестах нет. */
const ids = (paragraphs: string[]) =>
  findPatterns(buildCheckText(paragraphs.map((t, i) => ({ id: `b${i}`, paragraphIndex: i, kind: 'text' as const, userText: t })))).map((f) => f.ruleId);

const CASES: Array<[string, string]> = [
  ['integral-part', 'Удалённая работа стала неотъемлемой частью жизни миллионов людей.'],
  ['new-opportunities', 'Она открывает новые возможности как для сотрудников, так и для компаний.'],
  ['complex-approach', 'Здоровый сон требует комплексного подхода к вечеру.'],
  ['wide-range', 'Это даёт доступ к широкому кругу специалистов.'],
  ['key-aspect', 'Регулярность это ключевой фактор успеха.'],
  ['key-role', 'Такая модель играет всё более важную роль в бизнесе.'],
  ['key-role', 'Температура в спальне играет значительную роль.'],
  ['worth-doing', 'Также стоит позаботиться о плотных шторах.'],
  ['in-world-where', 'В мире, где информация обрушивается потоком, книга редкость.'],
  ['not-secret', 'Не секрет, что внимание стало дефицитным.'],
  ['lets-figure', 'Давайте разберёмся, какие шаги помогут.'],
  ['sum-up', 'Подводя итог, можно сказать, что сон важен.'],
  ['sum-up', 'В конечном счёте чтение возвращает время.'],
  ['remember-colon', 'Помните: забота о сне важна.'],
  ['as-so-and', 'Это полезно как для сотрудников, так и для компаний.'],
  ['chat-opener', 'Конечно! Вот ответ.'],
  ['chat-lead', 'Конечно! Вот несколько рекомендаций для выбора.'],
  ['chat-hope', 'Надеюсь, эти советы окажутся полезными!'],
  ['chat-offer', 'Если хотите, я могу подготовить таблицу.'],
];

describe('правила калибровки срабатывают на коротких выдержках', () => {
  for (const [id, text] of CASES) it(id + ': ' + text.slice(0, 40), () => expect(ids([text])).toContain(id));

  it('dash-is: только от трёх определений', () => {
    expect(ids(['Сон — это основа.', 'Режим — это ритм.'])).not.toContain('dash-is');
    expect(ids(['Сон — это основа.', 'Режим — это ритм.', 'Покой — это сила.'])).toContain('dash-is');
  });

  it('junk-connectives, junk-must-chain и junk-weak-amp: только от порога', () => {
    expect(ids(['Кроме того, это важно. Более того, это просто.'])).not.toContain('junk-connectives');
    expect(ids(['Кроме того, это важно. Более того, это просто. Вместе с тем есть нюанс.'])).toContain('junk-connectives');
    expect(ids(['Следует начать. Важно помнить. Необходимо проверить.'])).not.toContain('junk-must-chain');
    expect(ids(['Следует начать. Важно помнить. Необходимо проверить. Важно закончить.'])).toContain('junk-must-chain');
    expect(ids(['Это значительно помогло.'])).not.toContain('junk-weak-amp');
    expect(ids(['Это значительно помогло, значительная разница.'])).toContain('junk-weak-amp');
  });

  it('list-label-colon: три абзаца «Название: пояснение» подряд', () => {
    const two = ['Процессор: быстрый.', 'Память: большая.'];
    expect(ids(two)).not.toContain('list-label-colon');
    expect(ids([...two, 'Экран: яркий.'])).toContain('list-label-colon');
  });

  it('обычная речь не задевается', () => {
    const calm = ['Вчера мы с братом чинили велосипед. Колесо гнулось, цепь соскакивала, и всё же к вечеру поехали.', 'Он сказал, что завтра будет дождь.'];
    expect(ids(calm)).toEqual([]);
  });
});
