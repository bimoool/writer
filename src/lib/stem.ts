import { hasCyrillic, normalize } from './tokens';

/**
 * Простой суффиксный стеммер (SPEC §5 п.2). Это не Портер: он отрезает одно самое
 * длинное подходящее окончание так, чтобы основа осталась не короче 3 букв.
 * Задача у него узкая: склеить словоформы одного слова для tf-idf и метрики «Свои слова».
 */

// Сначала возвратная частица, затем окончания (64), отсортированные от длинных к коротким.
const RU_REFLEXIVE = ['ся', 'сь'];
const RU_ENDINGS = [
  // существительные и прилагательные
  'иями', 'ями', 'ами', 'ого', 'его', 'ому', 'ему', 'ыми', 'ими', 'ым', 'им', 'ием', 'иям', 'иях', 'ией',
  'ых', 'их', 'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ый', 'ий', 'ой', 'ей', 'ую', 'юю', 'ом', 'ем',
  'ам', 'ям', 'ах', 'ях', 'ов', 'ев', 'ия', 'ию', 'ья', 'ью',
  // глаголы
  'ешь', 'ете', 'ишь', 'ите', 'ют', 'ут', 'ат', 'ят', 'ет', 'ит', 'ал', 'ял', 'ил', 'ыл',
  'ть', 'ти', 'ла', 'ли', 'ло',
  // одиночные гласные и знаки
  'а', 'я', 'о', 'е', 'ы', 'и', 'у', 'ю', 'й', 'ь',
].sort((a, b) => b.length - a.length);

const EN_ENDINGS = ['ing', 'es', 'ed', 'ly', 's'];

const MIN_STEM = 3;

function cut(word: string, endings: readonly string[]): string {
  for (const e of endings) {
    if (word.endsWith(e) && word.length - e.length >= MIN_STEM) return word.slice(0, -e.length);
  }
  return word;
}

export function stemRu(word: string): string {
  return cut(cut(word, RU_REFLEXIVE), RU_ENDINGS);
}

export function stemEn(word: string): string {
  if (word.endsWith('ss')) return word;
  return cut(word, EN_ENDINGS);
}

/** Нормализует и стеммирует слово. Алфавит выбирается по самому слову, так что смешанный ru/en текст тоже работает. */
export function stem(word: string): string {
  const w = normalize(word);
  if (/\d/.test(w)) return w;
  return hasCyrillic(w) ? stemRu(w) : stemEn(w);
}

export const RU_ENDING_COUNT = RU_ENDINGS.length;
