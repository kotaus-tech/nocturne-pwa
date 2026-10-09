import { callBackgroundLLM } from "./apiClient";
import { findMentionedCharacter } from "./groupScene";
import type { ApiConfig, Character, SceneRelation } from "../types";

/**
 * Выбор говорящего в групповой сцене.
 *
 * Авто-режим: спрашиваем модель — кто из присутствующих отвечает первым.
 * Это отдельный лёгкий запрос (короткий промпт, десятки токенов): он не
 * мешает основному ответу и позволяет герою, которого задела реплика,
 * вступить первым, а не отвечать всем по очереди.
 *
 * Если модель ответила невнятно — падаем в понятную эвристику: тот, кого
 * игрок назвал по имени, иначе — последний вариант (первый в сцене).
 */

const MAX_RELATIONS = 6;

export interface SceneRoutingInput {
  /** Кто физически в сцене и может отвечать. */
  present: Character[];
  /** Микро-связи внутри группы — влияют на то, кого реплика задевает. */
  relations?: SceneRelation[];
  /**
   * Активные намерения присутствующих (из их личной памяти). Намерение —
   * «план к действию», а не приватная мысль, поэтому роутеру его видеть
   * допустимо: это смягчает «потерянные реакции» (ТЗ §8).
   */
  intentions?: { characterId: string; name: string; text: string }[];
  userName: string;
  /** Последняя реплика игрока. */
  lastUserText: string;
  /** Кто отвечал до этого — ему не отдаём ход сразу повторно. */
  lastSpeakerId?: string;
  directorNotes?: string;
}

export function buildRoutingPrompt(input: SceneRoutingInput): string {
  const roster = input.present
    .map((character) => {
      const brief =
        character.personality?.trim() ||
        character.tagline?.trim() ||
        character.description?.trim() ||
        "без подробностей";
      const short = brief.length > 140 ? `${brief.slice(0, 140).trim()}…` : brief;
      return `- ${character.name} (id: ${character.id}): ${short}`;
    })
    .join("\n");

  const namesById = new Map(input.present.map((item) => [item.id, item.name]));

  const relations = (input.relations ?? [])
    .filter((relation) => relation?.text?.trim())
    .slice(0, MAX_RELATIONS)
    .map((relation) => {
      const from = namesById.get(relation.from) || "Кто-то";
      const to = relation.to ? namesById.get(relation.to) || "кто-то" : "группа";
      return `- ${from} → ${to}: ${relation.text.trim()}`;
    })
    .join("\n");

  // Намерения — только те, что принадлежат присутствующим, и по одному на героя.
  const presentIds = new Set(input.present.map((item) => item.id));
  const intentions = (input.intentions ?? [])
    .filter((item) => item?.text?.trim() && presentIds.has(item.characterId))
    .slice(0, MAX_RELATIONS)
    .map((item) => `- ${item.name.trim()}: ${item.text.trim().slice(0, 120)}`)
    .join("\n");

  return (
    `Ты — режиссёр ролевой сцены с несколькими персонажами. Определи, кто из них отвечает СЕЙЧАС первым.\n\n` +
    `ПЕРСОНАЖИ В СЦЕНЕ:\n${roster}\n\n` +
    (intentions ? `ТЕКУЩИЕ НАМЕРЕНИЯ ПЕРСОНАЖЕЙ:\n${intentions}\n\n` : "") +
    (relations ? `ОТНОШЕНИЯ ВНУТРИ ГРУППЫ:\n${relations}\n\n` : "") +
    (input.directorNotes?.trim()
      ? `АТМОСФЕРА СЦЕНЫ: ${input.directorNotes.trim().slice(0, 300)}\n\n`
      : "") +
    `ПОСЛЕДНЯЯ РЕПЛИКА ИГРОКА (${input.userName}): «${input.lastUserText.trim().slice(0, 600)}»\n\n` +
    `КАК ВЫБИРАТЬ:\n` +
    `1. Если игрок обратился к кому-то по имени — отвечает он.\n` +
    `2. Если у кого-то из персонажей есть активное, нереализованное намерение, и текущая ситуация создаёт для него подходящий повод действовать по этому намерению — рассмотри его как сильного кандидата, даже если реплика формально не была направлена именно на него.\n` +
    `3. Иначе — тот, кого эта реплика задела сильнее всех по характеру и отношениям.\n` +
    `4. Не отдавай ход тому, кто только что говорил, если есть другие кандидаты.\n` +
    `5. Если реплика обращена ко всем — отвечает самый активный, самый заинтересованный, либо тот, у кого есть невысказанное намерение, требующее выхода прямо сейчас.\n\n` +
    `Ответь СТРОГО одной строкой, без пояснений:\n` +
    `[Отвечает: Имя]`
  );
}

/** Разбирает ответ роутера и находит персонажа по имени. */
export function parseRoutingAnswer(
  answer: string,
  present: Character[]
): Character | undefined {
  if (!answer || present.length === 0) return undefined;

  const tagged =
    answer.match(/\[Отвечает:\s*([^\]]+)\]/i) ||
    answer.match(/Отвечает:\s*([^\n,.]+)/i) ||
    answer.match(/<speaker>\s*([^<]+)\s*<\/speaker>/i);

  if (tagged) {
    const raw = tagged[1].trim().toLocaleLowerCase("ru-RU");

    const exact = present.find(
      (item) => item.name.trim().toLocaleLowerCase("ru-RU") === raw
    );
    if (exact) return exact;

    const partial = present.find((item) => {
      const name = item.name.trim().toLocaleLowerCase("ru-RU");
      return name.length > 2 && (raw.startsWith(name) || raw.includes(name));
    });
    if (partial) return partial;
  }

  // Модель ответила свободным текстом — ищем любое упоминание имени.
  return findMentionedCharacter(answer, present);
}

/** Спрашивает модель, кто отвечает первым. Ошибки не критичны — вернём undefined. */
export async function requestSceneSpeaker(
  config: ApiConfig,
  input: SceneRoutingInput,
  signal?: AbortSignal
): Promise<Character | undefined> {
  const answer = await callBackgroundLLM(
    config,
    buildRoutingPrompt(input),
    [{ role: "user", content: "[Кто отвечает первым?]" }],
    { signal }
  );

  return parseRoutingAnswer(answer, input.present);
}

/**
 * Полный выбор говорящего: авто-роутер, а при сбое — упоминание в тексте,
 * затем оценка от противного (не тот, кто говорил только что).
 */
export async function chooseSpeaker(
  config: ApiConfig,
  input: SceneRoutingInput,
  signal?: AbortSignal
): Promise<Character> {
  const mentioned = findMentionedCharacter(input.lastUserText, input.present);
  const others = input.present.filter((item) => item.id !== input.lastSpeakerId);
  const fallback = mentioned ?? others[0] ?? input.present[0];

  try {
    const routed = await requestSceneSpeaker(config, input, signal);
    if (routed) return routed;
  } catch {
    // сбой роутера — не повод не ответить игроку
  }

  return fallback;
}
