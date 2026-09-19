import type { LorebookEntry, Message } from "../types";

/**
 * Сканирует последние сообщения на наличие ключевых слов lorebook
 * и возвращает активированные записи для инъекции в системный промпт.
 */
export function activateLorebook(
  entries: LorebookEntry[],
  recentMessages: Message[],
  lookback = 3
): LorebookEntry[] {
  const active = entries.filter((e) => e.isActive);
  if (active.length === 0) return [];

  const window = recentMessages.slice(-lookback);
  const haystack = window
    .map((m) => m.swipes[m.currentSwipeIndex] ?? "")
    .join("\n")
    .toLowerCase();

  return active.filter((entry) =>
    entry.keys.some((key) => key.trim() && haystack.includes(key.trim().toLowerCase()))
  );
}
