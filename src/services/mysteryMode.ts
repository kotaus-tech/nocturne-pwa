import type { ChatSession } from "../types";

/**
 * Режим тайны — только слой отображения. Данные сессии и промпт модели не
 * меняются: мысли, факты, синопсис и личная память по-прежнему уходят в
 * запрос, скрывается только показ в интерфейсе.
 */

export const MYSTERY_TOASTS_LOCKED_HINT =
  "Заблокировано режимом тайны. Выключите режим, чтобы менять.";

/**
 * Патч сессии при переключении режима. Включение принудительно выключает
 * «Уведомления отношений»; при выходе из режима они остаются выключенными,
 * и пользователь включает их вручную.
 */
export function mysteryModePatch(enabled: boolean): Partial<ChatSession> {
  return enabled
    ? { mysteryMode: true, showRelationshipToasts: false }
    : { mysteryMode: false };
}

/** Плашки отношений создаются только если режим тайны выключен. */
export function canShowRelationshipToasts(
  session: Pick<ChatSession, "mysteryMode" | "showRelationshipToasts">
): boolean {
  return !session.mysteryMode && session.showRelationshipToasts !== false;
}

/** Копирование синопсиса берёт текст из данных сессии, а не из DOM. */
export async function copySynopsisFromSession(
  session: Pick<ChatSession, "summary">
): Promise<boolean> {
  const text = session.summary ?? "";
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
