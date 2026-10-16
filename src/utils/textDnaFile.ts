/** Безопасная проверка файла для Text DNA: принимаем только расширение .txt. */
export function isTextDnaTextFile(file: File | null | undefined): file is File {
  if (!file || typeof file.name !== "string") return false;
  return file.name.trim().toLocaleLowerCase().endsWith(".txt");
}

/**
 * Читает весь TXT без обрезания. MIME у drag-and-drop может быть пустым,
 * поэтому решение принимает расширение, а не недостоверный content type.
 */
export async function readTextDnaFile(file: File): Promise<string> {
  if (!isTextDnaTextFile(file)) {
    throw new Error("Text DNA принимает только файлы с расширением .txt.");
  }
  try {
    return await file.text();
  } catch {
    throw new Error("Не удалось прочитать TXT-файл. Проверьте файл и попробуйте ещё раз.");
  }
}

/** UI state transition: changing visibility must never mutate or clear source. */
export function toggleTextDnaSourceVisibility(state: {
  source: string;
  visible: boolean;
}): { source: string; visible: boolean } {
  return { source: state.source, visible: !state.visible };
}
