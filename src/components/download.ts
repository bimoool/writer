/** Скачивание текста как файла: временная ссылка на Blob. */
export function downloadText(fileName: string, text: string, mime = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  // Браузеру нужно время начать скачивание.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
