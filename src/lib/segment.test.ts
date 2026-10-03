import { describe, expect, it } from 'vitest';
import { APPENDIX_A } from './__fixtures__/appendix-a';
import { BLOCK_LIMITS, SOFT_MIN_WORDS, segment, splitParagraphs } from './segment';
import { countWords } from './tokens';

const words = (n: number, w = 'слово') => Array.from({ length: n }, () => w).join(' ');
/** Предложение ровно из n слов, с заглавной буквы: иначе ICU не видит границу предложения. */
const sentence = (n: number, w = 'слово') => {
  const s = words(n, w);
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
};

describe('абзацы, заголовки, списки (§6 п.1, п.7)', () => {
  it('пустой ввод даёт пустую разбивку', () => {
    expect(segment('')).toEqual([]);
    expect(segment('  \n\n \r\n ')).toEqual([]);
  });

  it('\\r\\n нормализуется, одиночный перенос внутри абзаца становится пробелом', () => {
    const blocks = segment('Первая строка абзаца идёт тут,\r\nа вторая строка продолжает её.\r\n\r\nВторой абзац тоже бывает.');
    expect(blocks.map((b) => b.text)).toEqual([
      'Первая строка абзаца идёт тут, а вторая строка продолжает её.',
      'Второй абзац тоже бывает.',
    ]);
    expect(blocks.map((b) => b.paragraphIndex)).toEqual([0, 1]);
  });

  it('строка с # становится заголовком без решёток', () => {
    const [h, p] = segment('## Тайм-менеджмент\nТекст абзаца сразу под заголовком без пустой строки.');
    expect(h).toMatchObject({ kind: 'heading', text: 'Тайм-менеджмент', paragraphIndex: 0 });
    expect(p).toMatchObject({ kind: 'text', paragraphIndex: 1 });
  });

  it('каждый пункт списка отдельным блоком, маркеры -, *, •, 1. убираются', () => {
    const blocks = segment('Шаги такие:\n- первый шаг\n* второй шаг\n• третий шаг\n1. четвёртый шаг\n2) пятый шаг');
    expect(blocks.map((b) => b.kind)).toEqual(['text', 'list-item', 'list-item', 'list-item', 'list-item', 'list-item']);
    expect(blocks.slice(1).map((b) => b.text)).toEqual(['первый шаг', 'второй шаг', 'третий шаг', 'четвёртый шаг', 'пятый шаг']);
    expect(new Set(blocks.map((b) => b.paragraphIndex)).size).toBe(6);
  });

  it('строка с отступом продолжает пункт списка', () => {
    const blocks = segment('- длинный пункт,\n  который перенесён\n- следующий');
    expect(blocks.map((b) => b.text)).toEqual(['длинный пункт, который перенесён', 'следующий']);
  });

  it('короткая строка без точки отдельным абзацем считается заголовком', () => {
    const [h, p] = segment('Техника Pomodoro\n\nЭто способ работать короткими интервалами и отдыхать.');
    expect(h!.kind).toBe('heading');
    expect(p!.kind).toBe('text');
  });

  it('короткая строка с точкой или двоеточием заголовком не считается', () => {
    expect(splitParagraphs('Это важно.')[0]!.kind).toBe('text');
    expect(splitParagraphs('Шаги такие:')[0]!.kind).toBe('text');
  });

  it('строка длиннее 8 слов без точки не заголовок', () => {
    expect(splitParagraphs(words(9))[0]!.kind).toBe('text');
  });

  it('текст из одних заголовков', () => {
    const blocks = segment('# Первый\n# Второй\n\n## Третий');
    expect(blocks.map((b) => [b.kind, b.text])).toEqual([
      ['heading', 'Первый'],
      ['heading', 'Второй'],
      ['heading', 'Третий'],
    ]);
  });
});

describe('длинные абзацы (§6 п.2–5)', () => {
  it('абзац не длиннее лимита становится одним блоком', () => {
    const text = `${sentence(20)} ${sentence(25)}`;
    expect(segment(text, 'medium')).toHaveLength(1);
  });

  it('абзац на 300 слов: блоки не длиннее лимита и не короче минимума, текст не теряется', () => {
    const text = Array.from({ length: 30 }, (_, i) => sentence(8 + (i % 5) * 1, 'текст')).join(' ');
    const total = countWords(text);
    expect(total).toBeGreaterThanOrEqual(290);
    for (const size of ['short', 'medium', 'long'] as const) {
      const blocks = segment(text, size);
      // Предложения не делятся, поэтому ceil(слов / лимит) только нижняя граница.
      expect(blocks.length).toBeGreaterThanOrEqual(Math.ceil(total / BLOCK_LIMITS[size]));
      expect(blocks.length).toBeLessThanOrEqual(Math.ceil((2 * total) / BLOCK_LIMITS[size]));
      for (const b of blocks) {
        expect(countWords(b.text)).toBeLessThanOrEqual(BLOCK_LIMITS[size]);
        expect(countWords(b.text)).toBeGreaterThanOrEqual(SOFT_MIN_WORDS);
      }
      expect(blocks.map((b) => b.text).join(' ')).toBe(text);
      expect(new Set(blocks.map((b) => b.paragraphIndex))).toEqual(new Set([0]));
    }
  });

  it('режет по границе предложения ближе к середине', () => {
    // 30 + 30 слов при лимите 45: два блока по 30, а не 45 + 15
    const a = sentence(10, 'альфа');
    const text = [a, a, a, sentence(10, 'бета'), sentence(10, 'бета'), sentence(10, 'бета')].join(' ');
    const blocks = segment(text, 'medium');
    expect(blocks.map((b) => countWords(b.text))).toEqual([30, 30]);
    expect(blocks[1]!.text.startsWith('Бета')).toBe(true);
  });

  it('очень длинное предложение режется по точке с запятой', () => {
    const text = `${words(30, 'один')}; ${words(30, 'два')}.`;
    const blocks = segment(text, 'medium');
    expect(blocks.map((b) => b.text)).toEqual([`${words(30, 'один')};`, `${words(30, 'два')}.`]);
  });

  it('очень длинное предложение режется по тире и по запятой перед союзом', () => {
    const dash = segment(`${words(28, 'раз')} — ${words(28, 'два')}.`, 'medium');
    expect(dash).toHaveLength(2);
    expect(dash[0]!.text.endsWith('—')).toBe(true);

    const conj = segment(`${words(28, 'раз')}, который ${words(27, 'два')}.`, 'medium');
    expect(conj.map((b) => b.text.split(' ')[0])).toEqual(['раз', 'который']);
  });

  it('из нескольких точек реза выбирается ближайшая к середине', () => {
    const text = `${words(10, 'а')}: ${words(20, 'б')}; ${words(30, 'в')}.`;
    const blocks = segment(text, 'medium');
    expect(blocks.map((b) => countWords(b.text))).toEqual([30, 30]);
  });

  it('предложение без знаков препинания режется по словам, но не внутри слова', () => {
    const text = words(60, 'слово');
    const blocks = segment(text, 'medium');
    expect(blocks).toHaveLength(2);
    for (const b of blocks) expect(b.text.split(' ').every((w) => w === 'слово')).toBe(true);
  });

  it('очень длинное слово и URL не режутся', () => {
    const url = `https://example.com/${'a'.repeat(300)}`;
    const blocks = segment(`Открой ссылку ${url} и прочитай. ${sentence(44)}`, 'medium');
    expect(blocks.some((b) => b.text.includes(url))).toBe(true);
  });

  it('короткий хвост приклеивается к предыдущему блоку (до лимит × 1.3)', () => {
    const text = `${sentence(44)} ${sentence(5, 'хвост')}`;
    const blocks = segment(text, 'medium');
    expect(blocks).toHaveLength(1);
    expect(countWords(blocks[0]!.text)).toBe(49);
  });

  it('короткое начало приклеивается к следующему блоку, а не остаётся отдельным (short: 5 + 24 слова)', () => {
    const text = `${sentence(5, 'начало')} ${sentence(24, 'середина')} ${sentence(20, 'конец')}`;
    const sizes = segment(text, 'short').map((b) => countWords(b.text));
    expect(sizes.every((n) => n >= 8)).toBe(true);
    expect(sizes.every((n) => n <= 25 * 1.3)).toBe(true);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(49);
  });

  it('короткий блок в середине приклеивается к соседу', () => {
    const text = `${sentence(24, 'первый')} ${sentence(4, 'мини')} ${sentence(24, 'третий')}`;
    const sizes = segment(text, 'short').map((b) => countWords(b.text));
    expect(sizes.every((n) => n >= 8)).toBe(true);
  });

  it('если приклеить некуда (оба соседа слишком большие), короткий блок остаётся', () => {
    const text = `${sentence(30, 'первый')} ${sentence(3, 'мини')} ${sentence(30, 'третий')}`;
    const sizes = segment(text, 'short').map((b) => countWords(b.text));
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(63);
    expect(sizes.every((n) => n <= 25 * 1.3 || n === 30)).toBe(true);
  });

  it('хвост не приклеивается, если вместе больше лимит × 1.3', () => {
    const text = `${sentence(45)} ${sentence(14)}`;
    expect(segment(text, 'medium').map((b) => countWords(b.text))).toEqual([45, 14]);
  });
});

describe('сокращения (§6 п.6)', () => {
  it('не режет после «т.е.», «т.д.» и «Dr.»', () => {
    const text = `${sentence(30)} Т.е. ${words(10)} И т.д. ${sentence(10, 'тоже')} Dr. Smith came here today.`;
    const blocks = segment(text, 'medium');
    for (const b of blocks) {
      expect(b.text).not.toMatch(/^(Smith|И т\.д\.$)/);
      expect(b.text.trim()).not.toBe('Т.е.');
    }
  });

  it('короткое «предложение» на сокращение склеивается со следующим', () => {
    const text = `${sentence(40, 'раз')} См. ${sentence(12, 'два')}`;
    const blocks = segment(text, 'medium');
    expect(blocks[blocks.length - 1]!.text.startsWith('См. Два')).toBe(true);
  });
});

describe('языки и пограничные случаи (§12)', () => {
  it('английский текст', () => {
    const text = Array.from({ length: 10 }, () => 'The quick brown fox jumps over the lazy dog.').join(' ');
    const blocks = segment(text, 'medium');
    expect(blocks).toHaveLength(2);
    expect(blocks.every((b) => countWords(b.text) === 45)).toBe(true);
  });

  it('текст из одного слова', () => {
    expect(segment('Привет')).toEqual([{ paragraphIndex: 0, kind: 'heading', text: 'Привет' }]);
    expect(segment('Привет.')).toEqual([{ paragraphIndex: 0, kind: 'text', text: 'Привет.' }]);
  });

  it('эмодзи и смешанный ru/en не ломают разбивку', () => {
    const text = 'Метод Pomodoro 🍅 помогает: work 25 minutes, потом отдых 5 минут. Это работает 👍.';
    const blocks = segment(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.text).toBe(text);
  });

  it('Приложение A при medium: по блоку на абзац', () => {
    const blocks = segment(APPENDIX_A, 'medium');
    expect(blocks.map((b) => b.paragraphIndex)).toEqual([0, 1, 2]);
    for (const b of blocks) expect(countWords(b.text)).toBeLessThanOrEqual(45);
  });

  it('Приложение A при short: блоки не длиннее 25 слов, разрез по предложениям', () => {
    const blocks = segment(APPENDIX_A, 'short');
    for (const b of blocks) {
      expect(countWords(b.text)).toBeLessThanOrEqual(25);
      expect(b.text).toMatch(/[.!?]$/);
    }
  });
});
