import type { Message, SecretEntry } from "../types";
import { newId } from "../utils/id";

/**
 * Тайные действия внутри обычного сообщения и тайный журнал.
 *
 * Модель получает всё. Персонажи получают только открытую часть сообщений.
 * Тайная часть остаётся у рассказчика (модели) и в журнале.
 */

export const SECRET_OPEN = "[[тайно: ";
export const SECRET_CLOSE = "]]";
const SECRET_RE = /\[\[тайно:\s*([\s\S]*?)\]\]/g;
const LEGACY_OOC_RE = /^\s*\[OOC:/i;

export interface TextSegment {
  secret: boolean;
  text: string;
}

/** Делит текст на открытые и тайные куски в порядке появления. */
export function splitSecretSpans(text: string): TextSegment[] {
  const out: TextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(SECRET_RE)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ secret: false, text: text.slice(last, index) });
    const inner = match[1].trim();
    if (inner) out.push({ secret: true, text: inner });
    last = index + match[0].length;
  }
  if (last < text.length) out.push({ secret: false, text: text.slice(last) });
  return out;
}

export function hasSecretSpans(text: string): boolean {
  return splitSecretSpans(text).some((segment) => segment.secret);
}

/** Только открытая часть: тайные куски вырезаны, лишние пробелы убраны. */
export function publicTextOf(text: string): string {
  if (!hasSecretSpans(text)) return text;
  return splitSecretSpans(text)
    .filter((segment) => !segment.secret)
    .map((segment) => segment.text)
    .join("")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.!?…])/g, "$1")
    .trim();
}

/** Для рассказчика: тайная часть сохраняется, но помечена словом «тайно». */
export function narratorTextOf(text: string): string {
  if (!hasSecretSpans(text)) return text;
  return text.replace(SECRET_RE, (_match, inner: string) => `[тайно: ${inner.trim()}]`);
}

/** Публикация: тайная часть становится обычным текстом. */
export function publishedTextOf(text: string): string {
  return splitSecretSpans(text)
    .map((segment) => segment.text)
    .join(" ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function isLegacyOocText(text: string): boolean {
  return LEGACY_OOC_RE.test(text);
}

function currentText(message: Message): string {
  return message.swipes[message.currentSwipeIndex] ?? "";
}

/** Видит ли персонаж сообщение целиком (до вырезания тайных кусков). */
export function isCharacterVisible(message: Message): boolean {
  if (message.sender === "system") return false;
  if ((message.channel ?? "scene") !== "scene") return false;
  if (message.sender === "user" && isLegacyOocText(currentText(message))) return false;
  return true;
}

/**
 * Вид истории для персонажей: без тайных и OOC-сообщений, в открытых
 * сообщениях — только открытая часть. Пустые после вырезания исчезают.
 */
export function characterView(messages: Message[]): Message[] {
  const out: Message[] = [];
  for (const message of messages) {
    if (!isCharacterVisible(message)) continue;
    const publicText = publicTextOf(currentText(message));
    if (!publicText.trim()) continue;
    out.push({ ...message, swipes: [publicText], currentSwipeIndex: 0 });
  }
  return out;
}

/** Вид для рассказчика: всё, включая тайное и OOC, тайные куски помечены. */
export function narratorView(messages: Message[]): Message[] {
  return messages
    .filter((message) => message.sender !== "system")
    .map((message) => {
      const text = currentText(message);
      // Целиком тайный ход рассказчика тоже помечаем, иначе он выглядит открытым.
      if (message.channel === "secret") {
        return { ...message, swipes: [`[тайно: ${text.trim()}]`], currentSwipeIndex: 0 };
      }
      if (!hasSecretSpans(text)) return message;
      return { ...message, swipes: [narratorTextOf(text)], currentSwipeIndex: 0 };
    });
}

/**
 * Вставка маркера по кнопке «Тайно». Работает и на телефоне: курсор
 * встаёт внутрь маркера, а выделенный текст оборачивается в маркер.
 */
export function insertSecretMarker(
  value: string,
  start: number,
  end: number
): { value: string; caret: number } {
  const before = value.slice(0, start);
  const selected = value.slice(start, end);
  const after = value.slice(end);
  const next = `${before}${SECRET_OPEN}${selected}${SECRET_CLOSE}${after}`;
  const caret = selected
    ? before.length + SECRET_OPEN.length + selected.length + SECRET_CLOSE.length
    : before.length + SECRET_OPEN.length;
  return { value: next, caret };
}

/** Записи журнала из тайных кусков сообщения игрока или тайного ответа. */
export function journalEntriesFromMessage(message: Message): SecretEntry[] {
  const text = currentText(message);
  const createdAt = message.timestamp || Date.now();

  if (message.channel === "secret") {
    const body = text.trim();
    if (!body) return [];
    return [{ id: newId(), text: body, sourceMessageId: message.id, createdAt }];
  }

  if (message.channel === "ooc") return [];

  return splitSecretSpans(text)
    .filter((segment) => segment.secret)
    .map((segment) => ({
      id: newId(),
      text: segment.text,
      sourceMessageId: message.id,
      createdAt,
    }));
}

/** Короткий псевдоним записи для модели: T1, T2… Нужен, чтобы не пересылать длинные id. */
export function journalAlias(index: number): string {
  return `T${index + 1}`;
}

/** Переводит псевдонимы из ответа модели в id записей того снимка журнала, что ушёл в промпт. */
export function resolveRevealedAliases(
  snapshot: SecretEntry[],
  aliases: string[]
): string[] {
  const wanted = new Set(aliases.map((alias) => alias.trim().toUpperCase()));
  return snapshot
    .map((entry, index) => (wanted.has(journalAlias(index)) ? entry.id : null))
    .filter((id): id is string => id !== null);
}

export function removeJournalEntries(journal: SecretEntry[], ids: string[]): SecretEntry[] {
  if (ids.length === 0) return journal;
  const drop = new Set(ids);
  return journal.filter((entry) => !drop.has(entry.id));
}

export function removeEntriesForMessage(journal: SecretEntry[], messageId: string): SecretEntry[] {
  return journal.filter((entry) => entry.sourceMessageId !== messageId);
}

/** Убирает записи, чьи сообщения уже удалены (откат, удаление). */
export function pruneOrphanEntries(journal: SecretEntry[], existingIds: Set<string>): SecretEntry[] {
  return journal.filter(
    (entry) => !entry.sourceMessageId || existingIds.has(entry.sourceMessageId)
  );
}

/** Блок журнала для хвоста промпта. Персонажам он не передаётся как реплика. */
export function journalPromptBlock(journal: SecretEntry[], isLocal: boolean): string | null {
  if (journal.length === 0) return null;
  const lines = journal
    .map((entry, index) => `- [${journalAlias(index)}] ${entry.text.replace(/\s+/g, " ")}`)
    .join("\n");
  const revealRule = isLocal
    ? ""
    : `\nЕсли по итогам ЭТОГО ответа персонаж в кадре реально узнал о какой-то записи, перечисли её номер в мета-поле "revealed": ["T1"]. Если никто ничего не узнал, поле не добавляй.`;
  return (
    `### ТАЙНЫ ИГРОКА (ЖУРНАЛ РАССКАЗЧИКА)\n` +
    `Эти события игрок совершил тайно. Персонажи о них НЕ знают: не видели, не слышали, не догадываются. Не реагируй на них, не намекай и не веди себя так, будто знаешь. Помни их ради последовательности мира.\n` +
    lines +
    revealRule
  );
}

/** Текст команды «ответь за меня». Пишет ход игрока, не реплики персонажей. */
export function buildNarrateDirective(
  userName: string,
  request: string,
  secret: boolean
): string {
  const text = request.trim();
  const what = text
    ? '"' + text + '"'
    : "(игрок ничего не уточнил — выбери действие по контексту сцены)";
  const head = secret
    ? `Режим «ответь за меня — тайно». Игрок (${userName}) делает это ТАЙНО от всех персонажей: ${what}.`
    : `Режим «ответь за меня — открыто». Игрок (${userName}) делает это открыто, персонажи это видят: ${what}.`;
  const secretRule = secret
    ? `Персонажи ничего из этого не замечают и не знают: не пиши их реакций, реплик и появления. Опиши конкретно, что игрок сделал, нашёл или узнал, чтобы он мог на это опираться.`
    : `Опиши только то, что игрок физически делает, без реакций персонажей. Коротко и по делу, без лишних подробностей.`;
  return (
    `[${head} Это команда интерфейса. Напиши ход игрока от первого лица, с его точки зрения. Действия в *звёздочках*. Не пиши реплики и действия других людей. ${secretRule} Только текст хода, без мета-блока и без пояснений.]`
  );
}

/** Текст команды ответа вне роли. Отвечает рассказчик, персонажи не слышат. */
export function buildOocDirective(userName: string, question: string): string {
  return (
    `[Вне роли. ${userName} обращается к рассказчику напрямую: "${question}". Ответь кратко и по существу, от лица рассказчика, не от лица персонажей. Персонажи этого не слышат. Без мета-блока.]`
  );
}

/** Убирает служебные блоки из ответа рассказчика, оставляя текст хода. */
export function cleanNarration(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, "")
    .replace(/<thought>[\s\S]*?<\/thought>/gi, "")
    .replace(/<stats[^>]*\/?>/gi, "")
    .trim();
}
