/**
 * Скачивание файлов, которые приложение собирает на лету.
 *
 * Мелочь, на которой часто спотыкаются: `URL.revokeObjectURL` сразу после
 * `link.click()` обрывает скачивание в части браузеров — файл не успевает
 * начать писаться. Поэтому ссылку удаляем сразу, а адрес держим живым ещё
 * минуту.
 */

/** Живём столько, сколько объектный адрес остаётся валидным. */
const REVOKE_DELAY_MS = 60_000;

/** Выкидывает из имени всё, что файловая система не даст записать. */
export function safeFileName(value: string, fallback = "nocturne"): string {
  const cleaned = (value || "")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);

  return cleaned || fallback;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;

  // Safari не начинает скачивание, пока ссылка не в документе.
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}
