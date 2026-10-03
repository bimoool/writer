interface Props<T extends string> {
  legend: string;
  name: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}

/**
 * Переключатель на 2–3 варианта в одну строку. Это обычные радиокнопки (стрелки, Tab и озвучивание работают
 * из коробки), а вид сегментов даёт подпись вокруг скрытого input. Выбранный сегмент светлее фона панели.
 */
export function Segmented<T extends string>({ legend, name, value, options, onChange }: Props<T>) {
  return (
    <fieldset className="mt-4 min-w-0">
      <legend className="text-meta text-text-dim">{legend}</legend>
      <div className="mt-1 flex w-full rounded-surface border border-line p-0.5">
        {options.map((o) => (
          <label
            key={o.value}
            className="flex min-h-10 min-w-0 flex-1 cursor-pointer items-center justify-center rounded-surface px-2 text-center text-meta text-text-dim transition-colors duration-[120ms] hover:text-text has-[:checked]:bg-bg has-[:checked]:text-text has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink"
          >
            <input type="radio" name={name} value={o.value} checked={o.value === value} onChange={() => onChange(o.value)} className="sr-only" />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
