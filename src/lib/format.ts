/** Форматирование для списка документов. */

/** Русское склонение: 1 документ, 2 документа, 5 документов, 11 документов, 21 документ. */
export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n);
  const d = abs % 10;
  const dd = abs % 100;
  if (d === 1 && dd !== 11) return one;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return few;
  return many;
}

const startOfDay = (t: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

export interface DateWords {
  today: string;
  yesterday: string;
}

/** «сегодня», «вчера», «2 окт», а для прошлых лет «2 окт 2025». Сравнение по календарным дням. */
export function formatDocDate(ts: number, now: number, words: DateWords): string {
  const days = Math.round((startOfDay(now) - startOfDay(ts)) / 86_400_000);
  if (days <= 0) return words.today;
  if (days === 1) return words.yesterday;

  const d = new Date(ts);
  const parts = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).formatToParts(d);
  const day = parts.find((p) => p.type === 'day')?.value ?? String(d.getDate());
  const month = (parts.find((p) => p.type === 'month')?.value ?? '').replace(/\.$/, '');
  const base = `${day} ${month}`;
  return d.getFullYear() === new Date(now).getFullYear() ? base : `${base} ${d.getFullYear()}`;
}
