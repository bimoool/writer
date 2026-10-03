/**
 * Скачивание файла: временная ссылка на Blob и a[download]. Работает и на iOS (Safari 13+), и на Android:
 * файл собирается в браузере, на сервер ничего не уходит.
 */
export function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  // Браузеру нужно время начать скачивание.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Скачивание текста как файла. */
export function downloadText(fileName: string, text: string, mime = 'application/json'): void {
  downloadBlob(fileName, new Blob([text], { type: `${mime};charset=utf-8` }));
}

/**
 * Можно ли отдать этот файл в системное меню «Поделиться». Проверяем конкретный файл: Chrome на Android
 * разрешает делиться только некоторыми типами (.txt да, .docx и .md нет), Safari на iOS почти любыми.
 */
export function canShareFile(file: File): boolean {
  try {
    return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/**
 * Системное меню «Поделиться» с файлом. Вызывать прямо из обработчика нажатия, файл должен быть готов заранее:
 * без жеста пользователя браузер откажет. Отмену пользователем ошибкой не считаем.
 */
export async function shareFile(file: File): Promise<'shared' | 'cancelled' | 'failed'> {
  try {
    await navigator.share({ files: [file] });
    return 'shared';
  } catch (e) {
    return e instanceof DOMException && e.name === 'AbortError' ? 'cancelled' : 'failed';
  }
}
