import type { Character } from "../types";
import { findMentionedCharacter } from "./groupScene";

/**
 * Инлайн-реакции «живой сцены» (ТЗ §9).
 *
 * В режиме «живой сцены» основной говорящий может завершить реплику
 * 1–2 короткими реакциями других присутствующих в формате
 * `— **Имя:** реплика`. Для корректного отображения такие строки
 * разбиваются на отдельные сообщения с верным автором.
 *
 * ВАЖНО: это исключительно косметическая операция. Такие реплики
 * сформулированы моделью ДРУГОГО персонажа, поэтому они НЕ должны
 * влиять на шкалы, связи, личную память «сказавшего» и не делают его
 * «только что говорившим» для анти-повтора роутера. В базе они
 * помечаются флагом `isLiveSceneEcho`.
 */

export interface LiveSceneReaction {
  /** Найденный персонаж-автор реакции (если имя распознано). */
  character?: Character;
  /** Имя, как его написал основной говорящий. */
  rawName: string;
  /** Текст реакции (без префикса имени). */
  text: string;
}

export interface SplitLiveSceneResult {
  /** Текст основного говорящего (реакции удалены). */
  mainText: string;
  /** Извлечённые реакции в порядке появления. */
  reactions: LiveSceneReaction[];
}

// Формат строки-реакции: тире, жирное имя, двоеточие, текст.
// Пример: «— **Рин:** Ну ты даёшь. *закатывает глаза*»
const REACTION_LINE = /^\s*[—–-]\s*\*\*([^*]+?)(?::)?\*\*\s*[:：]?\s*(.+)$/;

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase("ru-RU").replace(/[^\p{L}\p{N} ]/gu, "");
}

/**
 * Сопоставляет имя из реакции с присутствующими персонажами.
 * Сначала точное совпадение, затем поиск упоминания — терпимо к лёгким
 * расхождениям, но не выдумывает того, кого в сцене нет.
 */
export function matchReactionCharacter(
  rawName: string,
  candidates: Character[]
): Character | undefined {
  const needle = normalizeName(rawName);
  if (needle.length < 2) return undefined;

  const exact = candidates.find((item) => normalizeName(item.name) === needle);
  if (exact) return exact;

  return findMentionedCharacter(rawName, candidates);
}

/**
 * Отделяет завершающие строки-реакции от основного текста.
 *
 * Реакции ищутся СТРОГО в конце ответа и только подряд: как только встречается
 * строка, не подходящая под формат, разбор останавливается. Это защищает от
 * ситуации, когда обычный диалог с тире внутри реплики ошибочно принимается
 * за реакцию. Ограничение на число реакций — 2, как и обещает промпт
 * (небольшой запас на хвост не ломает смысл, но держит рамку).
 */
export function splitLiveSceneReactions(
  rawText: string,
  present: Character[],
  mainSpeakerId?: string,
  maxReactions = 2
): SplitLiveSceneResult {
  const lines = rawText.split("\n");
  const reactions: LiveSceneReaction[] = [];

  let index = lines.length;
  // Собираем реакции с конца, пока они идут сплошным хвостом.
  while (index > 0 && reactions.length < maxReactions) {
    const line = lines[index - 1];
    const match = line.match(REACTION_LINE);
    if (!match) break;

    const rawName = match[1].trim();
    const text = match[2].trim();
    const character = matchReactionCharacter(rawName, present);

    // Реакция основного говорящего на самого себя смысла не имеет — не трогаем.
    if (character && mainSpeakerId && character.id === mainSpeakerId) break;

    reactions.unshift({ character, rawName, text });
    index -= 1;
  }

  if (reactions.length === 0) {
    return { mainText: rawText, reactions: [] };
  }

  const mainText = lines.slice(0, index).join("\n").replace(/\s+$/, "");

  // Если «реакциями» оказался весь ответ — это не реакции, а обычный текст.
  if (!mainText.trim()) {
    return { mainText: rawText, reactions: [] };
  }

  return { mainText, reactions };
}
