import { describe, expect, it } from 'vitest';
import { APPENDIX_A } from './__fixtures__/appendix-a';
import { BLOCK_LIMITS } from './segment';
import { createDoc } from './doc';
import { phraseCapacity } from './keywords';
import { countWords } from './tokens';
import type { BlockSize } from './types';

/**
 * Критерии приёмки SPEC §13, которые можно проверить без браузера: п.1 (размер блоков) и п.2 (число фраз).
 * Тексты на 600+ слов собираются из набора реальных по длине предложений (3–40 слов) детерминированно.
 */

const RU = [
  'Планирование дня заранее снижает тревогу.',
  'Исследования показывают, что люди, которые записывают задачи с вечера, утром тратят меньше времени на выбор, с чего начать, и чаще доводят начатое до конца.',
  'Это работает не всегда.',
  'Главная ошибка состоит в том, что список дел превращается в длинную простыню из двадцати пунктов, половина из которых не имеет срока и не связана ни с одной реальной целью, поэтому к вечеру остаётся чувство, что день прошёл зря.',
  'Лучше выбрать три задачи, которые действительно важны, и защитить для них лучшие часы.',
  'Остальное можно делать в промежутках, когда энергии мало, а голова занята мелочами.',
  'Техника Pomodoro предлагает работать интервалами по 25 минут, разделёнными пятиминутными перерывами, и после четырёх таких циклов делать длинный отдых на 15–30 минут.',
  'Она помогает не отвлекаться, потому что у каждого отрезка есть конец.',
  'Однако для творческой работы, где мысль нужно держать долго, такой ритм иногда мешает: таймер звенит в тот момент, когда наконец удалось войти в поток.',
  'Тогда интервалы стоит удлинить.',
  'Многие забывают про отдых, считая его потерей времени, хотя именно во время перерыва мозг закрепляет прочитанное и находит неожиданные связи между идеями.',
  'Сон тоже входит в план.',
  'Нельзя рассчитывать на высокую продуктивность, если регулярно спать по пять часов, пить кофе литрами и обещать себе выспаться в выходные.',
  'Переключение между задачами стоит дорого: после каждого отвлечения, например на сообщение в мессенджере, требуется в среднем около двадцати минут, чтобы вернуться к прежней глубине концентрации.',
  'Поэтому уведомления лучше отключать.',
  'Полезно заканчивать день коротким обзором: что получилось, что нет и почему.',
  'Без этого шага опыт не накапливается, и завтра повторяются те же ошибки, только с другой датой в календаре, а привычка планировать так и не становится привычкой.',
  'Начни с малого.',
  'Один маленький шаг сегодня ценнее идеального плана, который ты не начнёшь никогда.',
  'Если задача кажется огромной, разбей её на части, каждая из которых занимает не больше получаса и заканчивается понятным результатом, например готовым абзацем, отправленным письмом или решённой задачей.',
  'И наконец, будь добрее к себе.',
  'Срыв графика не повод бросать систему, это повод её слегка подправить.',
  'Дисциплина строится из повторений, а не из героических усилий.',
];

const EN = [
  'Planning your day in advance reduces anxiety.',
  'Research suggests that people who write down their tasks the evening before spend less time deciding where to start, and they finish more of what they begin, although the effect varies a lot between individuals.',
  'This does not always work.',
  'The most common mistake is turning a to-do list into a long scroll of twenty items, half of which have no deadline and no link to any real goal, so by evening the day feels wasted even if you were busy all the time.',
  'It is better to pick three tasks that truly matter and protect your best hours for them.',
  'The rest can be done in the gaps, when energy is low and your head is full of small things.',
  'The Pomodoro technique suggests working in 25 minute intervals separated by five minute breaks, and taking a longer rest after four such cycles, which helps because every stretch of work has a visible end.',
  'For creative work, however, the timer sometimes rings exactly when you finally got into the flow.',
  'Rest is part of the plan too, because the brain consolidates what you read and finds unexpected links between ideas while you walk away from the desk.',
  'Start small.',
];

const mulberry = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Текст не короче `words` слов из пула, абзацы по 3–6 предложений. */
function compose(pool: string[], seed: number, words = 600): string {
  const rnd = mulberry(seed);
  const paragraphs: string[] = [];
  let total = 0;
  while (total < words) {
    const n = 3 + Math.floor(rnd() * 4);
    const para: string[] = [];
    for (let i = 0; i < n; i++) {
      let s = pool[Math.floor(rnd() * pool.length)]!;
      while (para.includes(s)) s = pool[Math.floor(rnd() * pool.length)]!; // одно предложение подряд дважды не пишут
      para.push(s);
    }
    const text = para.join(' ');
    paragraphs.push(text);
    total += countWords(text);
  }
  return paragraphs.join('\n\n');
}

/**
 * Три фразы по одному слову занимают 30% блока из 10 слов. У блока короче (8–9 слов) действует потолок покрытия
 * 30% (SPEC §5 п.6), он важнее нижней границы в 3 фразы, так что их там может быть меньше.
 */
const MIN_WORDS_FOR_THREE = 10;

const SIZES: BlockSize[] = ['short', 'medium', 'long'];
let n = 0;
const newId = () => `b${n++}`;

const texts: Array<[string, string]> = [
  ...Array.from({ length: 12 }, (_, i): [string, string] => [`ru #${i + 1}`, compose(RU, i + 1)]),
  ...Array.from({ length: 6 }, (_, i): [string, string] => [`en #${i + 1}`, compose(EN, 100 + i)]),
  ['приложение A ×6', Array.from({ length: 6 }, () => APPENDIX_A).join('\n\n')],
];

describe('SPEC §13 п.1: блоки не длиннее лимит × 1.3 и не короче 8 слов', () => {
  for (const [name, text] of texts) {
    for (const size of SIZES) {
      it(`${name}, ${size}`, () => {
        const doc = createDoc(text, { blockSize: size, now: 1, newId });
        expect(countWords(text)).toBeGreaterThanOrEqual(600);
        const limit = BLOCK_LIMITS[size];
        const perParagraph = new Map<number, number>();
        for (const b of doc.blocks) perParagraph.set(b.paragraphIndex, (perParagraph.get(b.paragraphIndex) ?? 0) + 1);
        for (const b of doc.blocks) {
          const w = countWords(b.sourceText);
          expect(w, `«${b.sourceText}»`).toBeLessThanOrEqual(limit * 1.3);
          if (b.kind !== 'text') continue;
          // Исключение §6 п.8: короткий отдельный абзац остаётся отдельным блоком.
          const standalone = perParagraph.get(b.paragraphIndex) === 1;
          if (!standalone) expect(w, `«${b.sourceText}»`).toBeGreaterThanOrEqual(8);
        }
      });
    }
  }
});

describe('SPEC §13 п.2: у блоков 3–6 фраз', () => {
  for (const [name, text] of texts) {
    for (const size of SIZES) {
      it(`${name}, ${size}`, () => {
        const doc = createDoc(text, { blockSize: size, now: 1, newId });
        for (const b of doc.blocks) {
          const w = countWords(b.sourceText);
          if (b.kind !== 'text') {
            expect(b.keyphrases.length, b.sourceText).toBeLessThanOrEqual(2);
          } else if (w >= MIN_WORDS_FOR_THREE) {
            // Если в блоке меньше трёх значимых слов, не касающихся друг друга, больше фраз выбрать просто негде.
            expect(b.keyphrases.length, `«${b.sourceText}»`).toBeGreaterThanOrEqual(Math.min(3, phraseCapacity(b.sourceText)));
            expect(b.keyphrases.length, `«${b.sourceText}»`).toBeLessThanOrEqual(6);
          }
        }
      });
    }
  }
});
