import { useEffect, useRef, useState } from 'react';

const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false;

/**
 * Перетаскивание файлов на окно. Слушаем window, чтобы файл, брошенный мимо поля,
 * не открылся браузером вместо импорта. Перетаскиваемый текст не трогаем: его обработает поле.
 * Возвращает true, пока над окном висит файл.
 */
export function useFileDrop(onFiles: (files: File[]) => void): boolean {
  const [dragging, setDragging] = useState(false);
  const handler = useRef(onFiles);

  useEffect(() => {
    handler.current = onFiles;
  });

  useEffect(() => {
    // dragenter и dragleave приходят парами от вложенных элементов, поэтому считаем глубину.
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) handler.current(files);
    };

    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);

  return dragging;
}
