/**
 * Копирование текста без зависимостей и внешних запросов.
 *
 * Основной способ — Clipboard API.
 * Резервный — document.execCommand("copy") для браузеров
 * и окружений, где современный API недоступен.
 */
export async function copyTextToClipboard(text: string): Promise<void> {
  try {
    if (
      typeof navigator !== "undefined" &&
      navigator.clipboard?.writeText
    ) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Пробуем резервный способ ниже.
  }

  if (typeof document === "undefined") {
    throw new Error("Копирование недоступно в этом окружении.");
  }

  const previousFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

  const textControl =
    previousFocus instanceof HTMLTextAreaElement ||
    previousFocus instanceof HTMLInputElement
      ? previousFocus
      : null;

  const previousInputSelection = textControl
    ? {
        start: textControl.selectionStart,
        end: textControl.selectionEnd,
        direction: textControl.selectionDirection,
      }
    : null;

  const selection = window.getSelection();
  const previousRanges: Range[] = [];

  if (selection) {
    for (let index = 0; index < selection.rangeCount; index += 1) {
      previousRanges.push(selection.getRangeAt(index).cloneRange());
    }
  }

  const dialogs = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[role="dialog"][aria-modal="true"]'
    )
  );

  const activeDialog = dialogs.reverse().find(
    (dialog) =>
      !dialog.closest("[inert]") &&
      dialog.getClientRects().length > 0
  );

  const host = activeDialog ?? document.body;
  const textarea = document.createElement("textarea");

  textarea.value = text;
  textarea.readOnly = true;
  textarea.tabIndex = -1;
  textarea.setAttribute("aria-label", "Копирование текста");

  Object.assign(textarea.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "1px",
    height: "1px",
    padding: "0",
    border: "0",
    margin: "0",
    opacity: "0",
    pointerEvents: "none",
    fontSize: "16px",
  });

  let copied = false;

  try {
    host.appendChild(textarea);
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);

    copied = document.execCommand("copy");
  } catch {
    copied = false;
  } finally {
    textarea.remove();

    if (previousFocus?.isConnected) {
      try {
        previousFocus.focus({ preventScroll: true });
      } catch {
        // Не мешаем завершению копирования.
      }
    }

    if (selection) {
      try {
        selection.removeAllRanges();

        for (const range of previousRanges) {
          if (range.commonAncestorContainer.isConnected) {
            selection.addRange(range);
          }
        }
      } catch {
        // Исходное содержимое могло измениться.
      }
    }

    if (
      textControl?.isConnected &&
      previousInputSelection?.start != null &&
      previousInputSelection.end != null
    ) {
      try {
        textControl.setSelectionRange(
          previousInputSelection.start,
          previousInputSelection.end,
          previousInputSelection.direction ?? undefined
        );
      } catch {
        // Не все типы input поддерживают выделение.
      }
    }
  }

  if (!copied) {
    throw new Error(
      "Браузер не позволил автоматически скопировать текст."
    );
  }
}