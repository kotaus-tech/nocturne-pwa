import type { ApiConfig } from "../types";
import { callBackgroundLLM, type ChatTurn } from "./apiClient";
import { extractJsonBlock } from "./jsonRepair";

/**
 * Понятная причина, когда модель ответила не JSON: раньше такой случай
 * подменялся дежурной записью дневника, и игрок не понимал, что память
 * на самом деле не обновилась.
 */
const JSON_FORMAT_ERROR =
  "Модель ответила не в формате JSON, поэтому память и дневник не обновились. " +
  "Повторите запрос или выберите модель, которая уверенно отвечает в JSON.";

export interface MemoryFact {
  keys: string[];
  content: string;
  isPinned?: boolean;
}

export interface MemoryExtractionResult {
  diaryThought: string;
  mood: string;
  activeFacts: MemoryFact[];
  summary: string;
}

/**
 * Очистка сырого ответа модели от блоков размышлений и markdown-обёрток
 */
function cleanModelOutput(raw: string): string {
  let text = raw;

  if (text.includes("</think>")) {
    text = text.split("</think>").pop() || "";
  }
  if (text.includes("</thought>")) {
    text = text.split("</thought>").pop() || "";
  }

  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thought>[\s\S]*?<\/thought>/gi, "")
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
}

/**
 * Безопасный парсер JSON, устойчивый к неэкранированным переносам строк,
 * тегам reasoning-моделей и лишнему тексту от LLM
 */
export function safeParseJson(raw: string): any {
  const cleaned = cleanModelOutput(raw);
  const extracted = extractJsonBlock(cleaned);

  if (extracted) {
    try {
      return JSON.parse(extracted.block);
    } catch {
      try {
        const sanitized = extracted.block.replace(
          /"([^"\\]*(\\.[^"\\]*)*)"/gs,
          (match) =>
            match.replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")
        );
        return JSON.parse(sanitized);
      } catch {
        // Оборванный ответ: extractJsonBlock уже знает, что дописать —
        // кавычку для незакрытой строки и скобки в порядке вложенности.
        const repaired = extracted.block + extracted.closers;

        try {
          return JSON.parse(repaired);
        } catch {
          // Ниже — последняя попытка вытащить хотя бы поля.
        }
      }
    }
  }

  const diaryMatch = cleaned.match(/"diaryThought"\s*:\s*"([\s\S]*?)(?<!\\)"/);
  const moodMatch = cleaned.match(/"mood"\s*:\s*"([\s\S]*?)(?<!\\)"/);
  const summaryMatch =
    cleaned.match(/"summary"\s*:\s*"([\s\S]*?)(?<!\\)"/) ||
    cleaned.match(/"storyEvent"\s*:\s*"([\s\S]*?)(?<!\\)"/);

  if (summaryMatch || diaryMatch) {
    return {
      diaryThought: diaryMatch ? diaryMatch[1].replace(/\\n/g, "\n") : undefined,
      mood: moodMatch ? moodMatch[1] : undefined,
      summary: summaryMatch ? summaryMatch[1].replace(/\\n/g, "\n") : undefined,
      activeFacts: [],
    };
  }

  throw new Error("JSON parse totally failed");
}

/**
 * Групповая сцена: короткая вставка о том, что в истории были и другие герои.
 * Память по-прежнему ведётся от лица основного персонажа, но модель видит
 * состав и не теряет чужие реплики и поступки.
 */
function groupCastNote(others?: string[]): string {
  const cast = (others ?? []).map((name) => name.trim()).filter(Boolean);
  if (cast.length === 0) return "";

  return `\n\nВАЖНО: это групповая сцена, вместе с тобой в ней были: ${cast.join(
    ", "
  )}. Учитывай их слова и поступки: в фактах фиксируй и то, что произошло между героями, а не только между тобой и игроком.`;
}

/**
 * Фоновое извлечение Дневника, Фактов и одного нового события (каждые 8 сообщений).
 */
export async function extractMemoriesAndDiary(
  apiConfig: ApiConfig,
  characterName: string,
  userName: string,
  transcript: string,
  existingFacts: MemoryFact[] = [],
  others?: string[]
): Promise<MemoryExtractionResult> {
  const pinnedFacts = existingFacts.filter((f) => f.isPinned);
  const unpinnedFacts = existingFacts.filter((f) => !f.isPinned);
  const availableSlots = Math.max(0, 18 - pinnedFacts.length);

  const pinnedFactsFormatted =
    pinnedFacts.length > 0
      ? pinnedFacts
          .map((f, i) => `${i + 1}. [${f.keys.join(", ")}] ${f.content}`)
          .join("\n")
      : "Нет закреплённых фактов.";

  const unpinnedFactsFormatted =
    unpinnedFacts.length > 0
      ? unpinnedFacts
          .map((f, i) => `${i + 1}. [${f.keys.join(", ")}] ${f.content}`)
          .join("\n")
      : "Пока нет сохранённых обычных фактов.";

  const systemPrompt = `Ты — внутренний голос и память персонажа по имени ${characterName}. Твоя цель — анализировать события диалога и возвращать данные строго в формате JSON.`;

  const prompt = `Проанализируй недавний диалог с ${userName}, обнови личный дневник, актуализируй факты и зафиксируй ключевое действие сцены.${groupCastNote(others)}

ЗАКРЕПЛЁННЫЕ ФАКТЫ (БАЗОВЫЕ — НЕ МЕНЯТЬ И НЕ ДУБЛИРОВАТЬ):
${pinnedFactsFormatted}

ОБЫЧНЫЕ ФАКТЫ ДЛЯ РЕВИЗИИ:
${unpinnedFactsFormatted}

НОВЫЙ ЭПИЗОД ДИАЛОГА ДЛЯ АНАЛИЗА:
${transcript}

---
ВЫПОЛНИ 3 ЗАДАЧИ:

1. ЛИЧНЫЙ ТАЙНЫЙ ДНЕВНИК (diaryThought & mood):
- Напиши искреннюю, живую запись от 1-го лица (${characterName}) о произошедшем (2–4 предложения).
- Передай настоящие мысли, сомнения, эмоции или реакцию на ${userName} простым разговорным языком без пафоса.
- mood: 1–2 слова текущего настроения.

2. ДИНАМИЧЕСКИЕ ЯКОРЯ ПАМЯТИ (activeFacts):
- Сделай ревизию обычных фактов, объединяя их с новыми деталями из диалога.
- СТРОГИЙ ЛИМИТ: Список activeFacts должен содержать МАКСИМУМ ${availableSlots} фактов.
- Каждый факт: 2–4 поисковых ключа (keys) и чёткая суть в одно предложение (content).

3. КРАТКОЕ СОБЫТИЕ СЦЕНЫ (summary):
- 1–2 ёмких предложения от 3-го лица о ключевых действиях и решениях недавнего эпизода.

ОТВЕТЬ СТРОГО В JSON-ФОРМАТЕ БЕЗ ЛИШНЕГО ТЕКСТА:
{
  "diaryThought": "Текст записи от первого лица персонажа...",
  "mood": "Настроение",
  "activeFacts": [
    { "keys": ["ключ1", "ключ2"], "content": "Ёмкий актуальный факт..." }
  ],
  "summary": "1-2 предложения о событиях недавней сцены..."
}`;

  const turns: ChatTurn[] = [{ role: "user", content: prompt }];
  // Служебный вызов идёт тем же каналом, что и чат (см. callBackgroundLLM):
  // на ru-openrouter.ru и polza.ai обычный «буферизованный» запрос обрывался,
  // а «думающие» модели уводили готовый JSON в поле размышлений.
  const raw = await callBackgroundLLM(apiConfig, systemPrompt, turns, { expectJson: true });

  try {
    const parsed = safeParseJson(raw);

    const rawFactsList: Array<{ keys?: string[]; content?: string }> = Array.isArray(
      parsed.activeFacts
    )
      ? parsed.activeFacts
      : Array.isArray(parsed.newFacts)
        ? parsed.newFacts
        : unpinnedFacts;

    const normalizedNewFacts: MemoryFact[] = rawFactsList
      .slice(0, availableSlots)
      .filter((f) => f && typeof f.content === "string" && f.content.trim().length > 0)
      .map((f) => ({
        keys: Array.isArray(f.keys) && f.keys.length > 0 ? f.keys : ["память"],
        content: f.content!.trim(),
        isPinned: false,
      }));

    const normalizedPinnedFacts: MemoryFact[] = pinnedFacts.map((f) => ({
      ...f,
      isPinned: true,
    }));

    const finalSummary = (parsed.summary || parsed.storyEvent || "").trim();

    return {
      diaryThought: parsed.diaryThought || "День выдался насыщенным...",
      mood: parsed.mood || "Задумчивость",
      activeFacts: [...normalizedPinnedFacts, ...normalizedNewFacts],
      summary: finalSummary,
    };
  } catch (err) {
    console.error("Safe JSON parse error in extractMemoriesAndDiary:", err);
    throw new Error(JSON_FORMAT_ERROR);
  }
}

/**
 * РУЧНАЯ ГЛУБОКАЯ АКТУАЛИЗАЦИЯ СИНОПСИСА (По кнопке Режиссёра)
 */
export async function directCompressStoryToSummary(
  apiConfig: ApiConfig,
  characterName: string,
  userName: string,
  rawStoryText: string,
  others?: string[]
): Promise<string> {
  const systemPrompt = `Ты — литературный редактор и внутренняя память персонажа по имени ${characterName}. Твоя задача — составить связное фактическое изложение истории без цензуры и штампов.`;

  const prompt = `Перед тобой хроника всех накопившихся событий и эпизодов общения с ${userName}:${groupCastNote(others)}

${rawStoryText}

---
ЗАДАЧА:
Составь цельное, глубокое, детализированное и связное фактическое изложение истории отношений между ${characterName} и ${userName} — как если бы это писал человек, наблюдающий за реальными событиями, а не автор книги.

СТРОГИЕ ПРАВИЛА:
1. ГРАДИЕНТ ДЕТАЛИЗАЦИИ:
   - НАЧАЛО И ЗНАКОМСТВО: Кратко зафиксируй, как завязался контакт и как ушли первые барьеры/маски.
   - КУЛЬТУРНЫЙ КОД И МИКРОЯКОРЯ (СОХРАНЯТЬ ОБЯЗАТЕЛЬНО): Все негласные ритуалы, секретные шифры, локальные шутки, прозвища, материальные якоря, привычки и триггеры.
   - РАЗВИТИЕ: Последовательно свяжи важные этапы, договорённости, совместный быт и переживания.
   - ТОЧКА «ЗДЕСЬ И СЕЙЧАС» (МАКСИМАЛЬНО ДЕТАЛЬНО): Точная локация, позы, одежда, атмосфера, эмоции и непосредственный шаг на ближайшую сцену.

2. ПРИНЦИП ФИЛЬТРАЦИИ:
   - Отсекай одноразовую механическую шелуху без последствий.
   - Сохраняй всё, что изменило доверие, статус-кво или стало привычкой.

3. СТИЛЬ:
   - КАТЕГОРИЧЕСКИЙ ЗАПРЕТ на книжный пафос, театральные монологи и слащавые штампы.
   - Пиши понятным, реалистичным, современным языком живого человека, сохраняя подлинный тон и характер персонажей.
   - Пиши подробно, связно и развёрнуто в объёмных смысловых абзацах.

4. ФОРМАТ: Выведи ТОЛЬКО готовый связанный текст истории без заголовков, нумерации и мета-комментариев.`;

  const turns: ChatTurn[] = [{ role: "user", content: prompt }];
  const raw = await callBackgroundLLM(apiConfig, systemPrompt, turns);
  const cleaned = cleanModelOutput(raw).replace(/^["'`]+|["'`]+$/g, "").trim();

  if (!cleaned) {
    throw new Error(
      "Модель не прислала текст синопсиса (ответ пришёл пустым или только с размышлениями). " +
        "Повторите запрос или увеличьте лимит токенов в настройках."
    );
  }

  return cleaned;
}

/**
 * Восстановление полной подробной Хроники эпизодов по всей истории сообщений чата
 */
export async function extractFullChronicleFromChat(
  apiConfig: ApiConfig,
  characterName: string,
  userName: string,
  transcript: string,
  others?: string[]
): Promise<string[]> {
  const castNote =
    (others ?? []).filter((name) => name.trim()).length > 0
      ? ` В истории участвуют несколько героев: ${(others ?? [])
          .map((name) => name.trim())
          .filter(Boolean)
          .join(", ")} — упоминай их по именам.`
      : "";

  const systemPrompt = `Ты — архивариус и хроникёр диалога между персонажами ${characterName} и ${userName}. Твоя задача — разбить историю на последовательные хронологические сюжетные эпизоды и вернуть результат строго в JSON.${castNote}`;

  const prompt = `Перед тобой полная история сообщений с момента знакомства до текущего момента:

${transcript}

---
ЗАДАЧА:
Разбей эту историю на последовательные хронологические сюжетные эпизоды (ориентировочно 1 эпизод на каждые 10–15 сообщений или на каждый значимый поворот/действие/сцену).

СТРОГИЕ ПРАВИЛА:
1. Каждый эпизод должен быть ровно ОДНИМ ёмким, живым и точным предложением от 3-го лица о том, что произошло в этой сцене.
2. Не пропускай этапы: начало, ссоры, сближение, важные решения, ночи, переезды и текущий момент.
3. Формат: выведи СТРОГО JSON-объект со списком строк "episodes".

ПРИМЕР ФОРМАТА:
{
  "episodes": [
    "Персонажи познакомились в застрявшем вагоне метро, начав диалог с взаимных подколок.",
    "После эмоционального разговора на крыше пара призналась в чувствах..."
  ]
}`;

  const turns: ChatTurn[] = [{ role: "user", content: prompt }];
  // Служебный вызов идёт тем же каналом, что и чат (см. callBackgroundLLM):
  // на ru-openrouter.ru и polza.ai обычный «буферизованный» запрос обрывался,
  // а «думающие» модели уводили готовый JSON в поле размышлений.
  const raw = await callBackgroundLLM(apiConfig, systemPrompt, turns, { expectJson: true });

  try {
    const parsed = safeParseJson(raw);
    if (Array.isArray(parsed?.episodes)) {
      return parsed.episodes
        .map((e: any) => String(e || "").trim())
        .filter((e: string) => e.length > 0);
    }
    if (Array.isArray(parsed)) {
      return parsed
        .map((e: any) => String(e || "").trim())
        .filter((e: string) => e.length > 0);
    }
  } catch {
    // Резервный разбор на случай, если локальная модель вывела нумерованный список вместо JSON
    const lines = raw
      .split("\n")
      .map((l) =>
        l
          .replace(/^\s*\d+[\.\)]\s*/, "")
          .replace(/^["'\-*]\s*/, "")
          .replace(/["']$/, "")
          .trim()
      )
      .filter((l) => l.length > 12 && !l.startsWith("{") && !l.startsWith("}"));

    if (lines.length > 0) return lines;
  }

  throw new Error(
    "Модель не вернула ни одного эпизода для хроники. Повторите запрос или выберите модель, " +
      "которая уверенно отвечает в JSON."
  );
}
