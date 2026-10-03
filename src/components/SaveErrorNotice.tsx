import { ru } from '../i18n/ru';
import { useApp } from '../store/app';

/** Тихая строка об ошибке сохранения. Исчезает сама после успешной записи. */
export function SaveErrorNotice() {
  const error = useApp((s) => s.saveError);
  if (!error) return null;
  return (
    <p role="alert" className="mx-auto max-w-[64ch] px-4 py-2 text-meta text-danger">
      {ru.saveError[error]}
    </p>
  );
}
