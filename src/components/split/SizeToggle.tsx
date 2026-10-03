import { ru } from '../../i18n/ru';
import type { BlockSize } from '../../lib/types';

const SIZES: readonly BlockSize[] = ['short', 'medium', 'long'];

interface Props {
  value: BlockSize;
  disabled: boolean;
  onChange: (size: BlockSize) => void;
}

/** Переключатель размера блоков: «Короткие / Средние / Длинные». */
export function SizeToggle({ value, disabled, onChange }: Props) {
  return (
    <div role="radiogroup" aria-label={ru.split.sizeLabel} className="flex w-full rounded-surface border border-line p-0.5 sm:w-auto">
      {SIZES.map((size) => (
        <button
          key={size}
          type="button"
          role="radio"
          aria-checked={value === size}
          disabled={disabled}
          onClick={() => onChange(size)}
          className={`min-h-10 flex-1 rounded-surface px-3 text-meta transition-colors duration-[120ms] disabled:cursor-default sm:flex-none ${
            value === size ? 'bg-surface text-text' : 'text-text-dim enabled:hover:text-text'
          }`}
        >
          {ru.split.sizes[size]}
        </button>
      ))}
    </div>
  );
}
