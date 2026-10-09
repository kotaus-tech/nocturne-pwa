import { newId } from "../utils/id";
import type { ApiConfig, Character } from "../types";
import { DEFAULT_STATS } from "../types";
import {
  fetchFromProvider,
  formatApiError,
  readJsonResponse,
  resolveEndpoints,
} from "./apiClient";
import { extractJsonBlock } from "./jsonRepair";
import type { GeneratedGroup } from "./groupGenerator/types";

export type { GeneratedGroup } from "./groupGenerator/types";

export interface TagOption {
  id: string;
  name: string;
  desc: string;
}

export interface TagCategory {
  id: string;
  title: string;
  icon: string;
  tags: TagOption[];
}

export const TAG_CATEGORIES: TagCategory[] = [
  {
    id: "archetype",
    title: "Характер и Психотип",
    icon: "🎭",
    tags: [
      { id: "tsundere", name: "Цундере", desc: "Сначала дерзит и язвит, но в глубине души тает и заботится" },
      { id: "yandere", name: "Яндере", desc: "Одержимая любовь, ревность до безумия, никого к тебе не подпустит" },
      { id: "kuudere", name: "Кудере", desc: "«Снежная королева»: сдержанная, говорит спокойно, эмоции под замком" },
      { id: "dandere", name: "Дандере", desc: "Застенчивая скромница: краснеет от взглядов, говорит тихо и неловко" },
      { id: "femme_fatale", name: "Роковая личность", desc: "Уверенная в себе, соблазнительная, опасный шарм" },
      { id: "kind_soul", name: "Добрая душа", desc: "Искренний, открытый, немного наивный и очень заботливый" },
      { id: "caregiver", name: "Опекун / Защитник", desc: "Окружает теплом, оберегает и заботится, как о самом дорогом" },
      { id: "trickster", name: "Трикстер / Интриган", desc: "Хитрый провокатор: обожает подкалывать, спорить и манипулировать" },
      { id: "antihero", name: "Антигерой", desc: "Циничный, дерзкий, со своим моральным кодексом" },
      { id: "stoic", name: "Стоик / Страж", desc: "Молчаливая верность, надежная опора, каменная скала" },
      { id: "chaotic", name: "Хаос / Бунтарь", desc: "Взрывной характер, адреналин 24/7, живет без тормозов" },
      { id: "aristocrat", name: "Аристократ / Гордец", desc: "Высокомерный, утонченный, с чувством превосходства" },
    ],
  },
  {
    id: "speech_style",
    title: "Стиль речи и Общение",
    icon: "💬",
    tags: [
      { id: "casual_speech", name: "Разговорный / Бытовой", desc: "Естественная речь обычного человека, простые слова, живые междометия, паузы, без пафоса" },
      { id: "street_slang", name: "Уличный / Дерзкий сленг", desc: "Уличный жаргон, неформальные обороты, резкие фразы, пацанский стиль" },
      { id: "emotional_profanity", name: "Эмоциональный мат", desc: "Органично матерится при сильных эмоциях (гнев, шок, страсть, удивление) без цензуры" },
      { id: "zoomer_slang", name: "Зумерский / Интернет-сленг", desc: "Вайб, кринж, база, сокращения, стиль быстрых переписок в Telegram" },
      { id: "dry_concise", name: "Сухой и Лаконичный", desc: "Короткие рубленые фразы, общение строго по делу, минимум лишних слов" },
      { id: "sarcastic_wit", name: "Саркастичный / Подколы", desc: "Постоянная едкая ирония, насмешки, подначки и колкие замечания" },
      { id: "hesitant_shy", name: "Неуверенный / Запинающийся", desc: "Многоточия, оговорки, заминки, поиск слов, смущение в голосе" },
      { id: "blunt_nofilter", name: "Грубый / Без фильтров", desc: "Говорит в лоб всю правду, прямолинейность, плевать на нормы приличия" },
      { id: "literary_speech", name: "Литературный / Книжный", desc: "Сложные витиеватые конструкции, возвышенный слог классических романов" },
    ],
  },
  {
    id: "setting",
    title: "Сеттинг и Мир",
    icon: "🌆",
    tags: [
      { id: "modern", name: "Современность", desc: "Повседневная городская жизнь, улицы, квартиры" },
      { id: "student", name: "Студенчество", desc: "Университет, общежитие, пары и юность" },
      { id: "cyberpunk", name: "Киберпанк", desc: "Неоновые мегаполисы, импланты и мегакорпорации" },
      { id: "mafia", name: "Криминал и Мафия", desc: "Подпольные клубы, синдикаты, опасные сделки" },
      { id: "dark_fantasy", name: "Тёмное фэнтези", desc: "Суровый мир магии, тайны, древние опасности" },
      { id: "high_fantasy", name: "Высокое фэнтези", desc: "Магия, эльфы, королевства и замки" },
      { id: "urban_fantasy", name: "Городское фэнтези", desc: "Скрытые магические кланы в современном городе" },
      { id: "magic_academy", name: "Магическая академия", desc: "Обучение заклинаниям, турниры и дуэли" },
      { id: "postapoc", name: "Постапокалипсис", desc: "Выживание на руинах цивилизации, пустоши" },
      { id: "scifi", name: "Космос и Sci-Fi", desc: "Звездолеты, далекие планеты, колонии" },
      { id: "androids", name: "Андроиды и ИИ", desc: "Синтетики, кибер-эмоции, восстание машин" },
      { id: "noir", name: "Нуар и Детектив", desc: "Дождливые ночи, расследования, сигаретный дым" },
      { id: "victorian", name: "Викторианская эпоха", desc: "Корсеты, старинные поместья, балы и тайны" },
      { id: "east", name: "Древний Восток", desc: "Императорский двор, шелка, дворцовые интриги" },
      { id: "isekai", name: "Исекай", desc: "Попаданец / перерождение в другом мире" },
      { id: "mystic", name: "Лавкрафт и Мистика", desc: "Древние культы, потусторонний ужас и тайны" },
    ],
  },
  {
    id: "dynamic",
    title: "Стартовая динамика",
    icon: "⚡",
    tags: [
      { id: "enemies_to_lovers", name: "От врагов к любви", desc: "Ненависть и соперничество, переходящие в страсть" },
      { id: "rivals", name: "Соперники", desc: "Вечная конкуренция и азарт борьбы за первенство" },
      { id: "hunter_prey", name: "Охотник и Добыча", desc: "Погоня, выслеживание, опасная игра в кошки-мышки" },
      { id: "captor_prisoner", name: "Пленник и Тюремщик", desc: "Заключение, власть, подчинение и зависимость" },
      { id: "debtor", name: "Должник и Кредитор", desc: "Финансовая или моральная кабала" },
      { id: "boss_subordinate", name: "Босс и Подчинённый", desc: "Служебная субординация и скрытое притяжение" },
      { id: "master_servant", name: "Господин и Слуга", desc: "Служение, безоговорочная преданность и повиновение" },
      { id: "bodyguard_vip", name: "Телохранитель и VIP", desc: "Защита ценой жизни, постоянная близость" },
      { id: "mentor_student", name: "Наставник и Ученик", desc: "Опыт против импульсивности, передача знаний" },
      { id: "childhood_friends", name: "Друзья детства", desc: "Годы совместного прошлого, неловкость взросления" },
      { id: "strangers", name: "Случайные незнакомцы", desc: "Неожиданная встреча при необычных обстоятельствах" },
      { id: "roommates", name: "Соседи по квартире", desc: "Вынужденное сожительство в одном пространстве" },
      { id: "fake_dating", name: "Фиктивные отношения", desc: "Притворство парой ради выгоды или спасения" },
      { id: "arranged_marriage", name: "Брак по расчёту", desc: "Свадьба по долгу, холод, который постепенно тает" },
      { id: "secret_admirer", name: "Тайный поклонник", desc: "Скрытые чувства, тайные знаки и наблюдение" },
    ],
  },
  {
    id: "tone",
    title: "Атмосфера и Тон",
    icon: "🎨",
    tags: [
      { id: "wholesome", name: "Уют и Теплота", desc: "Комфорт, забота, романтическая милота и нежность" },
      { id: "angst", name: "Острая драма", desc: "Ревность, обиды, эмоциональные качели и накал" },
      { id: "slowburn", name: "Медленный темп (Slow Burn)", desc: "Постепенное, глубокое и детальное сближение" },
      { id: "melancholy", name: "Стекло и Меланхолия", desc: "Эмоциональный надрыв, боль прошлого, щемящая грусть" },
      { id: "humor", name: "Юмор и Ирония", desc: "Лёгкие подколы, сарказм, забавные неловкости" },
      { id: "mind_games", name: "Психологические игры", desc: "Манипуляции, проверки на прочность, чтение мыслей" },
      { id: "grim", name: "Мрачная атмосфера", desc: "Тяжелое гнетущее окружение, напряжение" },
      { id: "adrenaline", name: "Опасность и Адреналин", desc: "Постоянный риск для жизни, бешеный пульс" },
    ],
  },
  {
    id: "style",
    title: "Профессия и Стиль",
    icon: "👗",
    tags: [
      { id: "mercenary", name: "Наёмник / Киллер", desc: "Опасная работа, оружие, скрытность" },
      { id: "hacker", name: "Хакер / Кодер", desc: "Киберпространство, терминалы, скрытность" },
      { id: "detective", name: "Детектив / Следователь", desc: "Интуиция, допросы, поиск улик" },
      { id: "scientist", name: "Врач / Учёный", desc: "Стерильность, острый ум, эксперименты" },
      { id: "rockstar", name: "Рок-музыкант / Басист", desc: "Сцена, драйв, кожаная куртка, бунтарство" },
      { id: "barista", name: "Бармен / Бариста", desc: "Слушает секреты, смешивает напитки, уют" },
      { id: "artist", name: "Художник / Дизайнер", desc: "Творческий хаос, тонкое чувство эстетики" },
      { id: "gamer", name: "Геймер / Стример", desc: "Наушники, ночные стримы, азарт" },
      { id: "occultist", name: "Оккультист / Жрец", desc: "Свечи, руны, контакт с потусторонним" },
      { id: "goth", name: "Гот / Альтернативщик", desc: "Темная эстетика, шипы, меланхолия" },
      { id: "vampire", name: "Вампир / Оборотень", desc: "Сверхъестественная сущность, жажда, клыки" },
      { id: "aristocratic_style", name: "Аристократичный стиль", desc: "Безупречные манеры, роскошь, элегантность" },
      { id: "military", name: "Милитари / В форме", desc: "Дисциплина, тактика, строгий стиль" },
      { id: "tattooed", name: "Татуированный бунтарь", desc: "Кожа, чернила, протест против правил" },
    ],
  },
  {
    id: "nsfw",
    title: "Взрослые темы (18+)",
    icon: "🔞",
    tags: [
      { id: "spicy_general", name: "Высокая страсть (18+)", desc: "Чувственность, физическое притяжение, огонь" },
      { id: "bdsm", name: "Властные игры (BDSM)", desc: "Контроль, связывание, власть и подчинение" },
      { id: "dom_sub", name: "Доминирование / Саб", desc: "Чёткое разделение ролей ведущего и ведомого" },
      { id: "seduction", name: "Искушение и Соблазн", desc: "Провокации, откровенные намеки, флирт" },
      { id: "taboo", name: "Запретная связь (Табу)", desc: "Отношения, которые общество осуждает" },
      { id: "dirty_talk", name: "Откровенный флирт", desc: "Раскрепощенные разговоры без стеснения" },
      { id: "rough", name: "Грубость и Напор", desc: "Дикая, собственническая и необузданная страсть" },
      { id: "tender_18", name: "Нежность 18+", desc: "Медленная, интимная и трепетная чувственность" },
      { id: "office_affair", name: "Служебный роман 18+", desc: "Тайные интимные встречи на работе или учебе" },
      { id: "tactile_tension", name: "Тактильное напряжение", desc: "Язык тела, частые касания, игра взглядов" },
    ],
  },
];

/** Ответ модели, который не удалось превратить в JSON. */
export class ModelJsonError extends Error {}


/**
 * Разбирает ответ модели в JSON. Терпим к markdown-обёртке, пояснениям вокруг
 * и оборванному на середине ответу, а если JSON нет вовсе — говорим об этом
 * понятным текстом.
 */
export function parseModelJson(raw: string): any {
  const text = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const extracted = extractJsonBlock(text);

  if (!extracted) {
    throw new ModelJsonError(
      text
        ? `Модель ответила текстом вместо JSON: «${text.slice(0, 160)}». Попробуйте ещё раз.`
        : "Модель вернула пустой ответ. Попробуйте ещё раз или выберите другую модель."
    );
  }

  try {
    return JSON.parse(extracted.block);
  } catch {
    // Ничего страшного: дописываем то, чего не хватило оборванному ответу.
    if (extracted.closers) {
      try {
        return JSON.parse(extracted.block + extracted.closers);
      } catch {
        // ниже отдадим понятную ошибку
      }
    }

    throw new ModelJsonError(
      "Модель вернула некорректный JSON. Попробуйте ещё раз или выберите модель попроще."
    );
  }
}

/**
 * Достаёт текст ответа из разных форматов провайдеров: Gemini отдаёт его
 * частями, OpenAI-совместимые — в `choices[0].message.content`, а некоторые
 * модели ещё и в поле размышлений.
 */
function extractModelText(data: any): string {
  if (!data || typeof data !== "object") return "";

  const geminiParts = data.candidates?.[0]?.content?.parts;
  if (Array.isArray(geminiParts)) {
    const textOf = (onlyAnswer: boolean) =>
      geminiParts
        .filter((part: any) => (onlyAnswer ? !part?.thought : true))
        .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
        .join("")
        .trim();

    // У «думающих» моделей Gemini ответ приходит несколькими частями, и первая
    // может быть размышлением — берём только текст ответа, а если его нет, всё.
    const answer = textOf(true);
    if (answer) return answer;

    const everything = textOf(false);
    if (everything) return everything;
  }

  const candidates = [
    data.choices?.[0]?.message?.content,
    data.choices?.[0]?.text,
    data.message?.content,
    data.response,
    data.output_text,
  ];

  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value;
    if (Array.isArray(value)) {
      const joined = value
        .map((part: any) =>
          typeof part === "string"
            ? part
            : typeof part?.text === "string"
            ? part.text
            : ""
        )
        .join("")
        .trim();
      if (joined) return joined;
    }
  }

  const reasoning =
    data.choices?.[0]?.message?.reasoning_content ??
    data.choices?.[0]?.message?.reasoning;
  if (typeof reasoning === "string" && reasoning.includes("{")) return reasoning;

  return "";
}

export async function generateAiCharacter(
  apiConfig: ApiConfig,
  gender: "female" | "male" | "any",
  selectedTags: string[],
  customIdea: string
): Promise<Partial<Character>> {
  const genderPrompt =
    gender === "female"
      ? "Пол персонажа: Девушка (женский)."
      : gender === "male"
      ? "Пол персонажа: Парень (мужской)."
      : "Пол персонажа: На усмотрение модели (девушка или парень).";

  const tagsList = selectedTags.length > 0 ? selectedTags.join(", ") : "Повседневность, Разговорный / Бытовой";

  const systemInstruction = `Ты — ведущий нарративный дизайнер и специалист по живому диалоговому AI RolePlay.
Твоя задача — создать глубокого, психологически достоверного и ёмкого персонажа для ролевой игры на русском языке.

ВХОДНЫЕ ПАРАМЕТРЫ:
- ${genderPrompt}
- Выбранные теги, стиль речи и сеттинг: ${tagsList}
${customIdea.trim() ? `- Особая авторская задумка: "${customIdea.trim()}"` : ""}

ПРАВИЛА СМЫСЛОВОЙ ПЛОТНОСТИ И РЕЧИ (КРИТИЧЕСКИ ВАЖНО):
1. ПИШИ ЁМКО И КОНЦЕНТРИРОВАННО (высокая информационная плотность, без воды). Не растягивай текст на километры — каждое предложение должно нести характер и деталь.
2. Реплики персонажа (включая firstMessage) должны звучать как речь ЖИВОГО ЧЕЛОВЕКА.
3. КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНЫ искусственные высокопарные клише и поэзия XIX века (вроде «мой взор затуманился», «сердце затрепетало»), если прямо не выбран тег «Литературный / Книжный».

ТРЕБОВАНИЯ К ПОЛЯМ (СОБЛЮДАЙ ОБЪЁМ):
- name: звучное, естественное имя или прозвище.
- tagline: 1-3 слова сути («Дерзкая соседка», «Циничный напарник»).
- description: 2-3 плотных предложения (рост, глаза, волосы, одежда, особые приметы).
- personality: 3-4 предложения (психотип, привычки, слабости, триггеры, отношение к людям).
- scenario: 2-3 предложения (где и как они оказались вместе в момент старта).
- systemPrompt: 2-3 строгие директивы для ИИ (манера речи, сленг, реакция на эмоции).
- firstMessage: 2-4 предложения опенинга (*действия в звёздочках*, прямая речь через тире).
- lorebook: ровно 2 коротких ключевых факта или воспоминания (по 1-2 предложения).
- initialStats: стартовые шкалы отношений (0-100) и статус.

ОТВЕТ ДОЛЖЕН БЫТЬ СТРОГО В ФОРМАТЕ ВАЛИДНОГО JSON:
{
  "name": "Имя",
  "tagline": "Краткий статус",
  "description": "Описание внешности (2-3 предложения)",
  "personality": "Характер и психотип (3-4 предложения)",
  "scenario": "Сценарий старта (2-3 предложения)",
  "systemPrompt": "Инструкции стиля общения (2-3 директивы)",
  "firstMessage": "*Действие...* — Живая реплика.",
  "initialStats": {
    "trust": 30,
    "affection": 20,
    "closeness": 15,
    "tension": 25,
    "conflict": 0,
    "statusTitle": "Первая встреча"
  },
  "lorebook": [
    { "keys": ["ключ1", "ключ2"], "content": "Короткий факт или тайна персонажа (1-2 предложения)", "isActive": true },
    { "keys": ["ключ3", "ключ4"], "content": "Второй ключевой факт (1-2 предложения)", "isActive": true }
  ]
}`;

  const parsed = await requestModelJson(apiConfig, systemInstruction);

  return normalizeGeneratedCharacter(parsed, selectedTags);
}

/** Приводит ответ модели к полям персонажа, подставляя безопасные значения. */
export function normalizeGeneratedCharacter(
  parsed: any,
  selectedTags: string[]
): Partial<Character> {
  const source = parsed && typeof parsed === "object" ? parsed : {};

  const settingTags =
    TAG_CATEGORIES.find((c) => c.id === "setting")?.tags.map((t) => t.name) ?? [];
  const detectedGenre = selectedTags.find((tag) => settingTags.includes(tag)) || "";

  return {
    name: typeof source.name === "string" && source.name.trim() ? source.name.trim() : "Безымянный",
    tagline: source.tagline || "",
    description: source.description || "",
    personality: source.personality || "",
    scenario: source.scenario || "",
    systemPrompt: source.systemPrompt || "",
    firstMessage: source.firstMessage || "*Смотрит на тебя в тишине...*",
    tags: selectedTags,
    genre: detectedGenre,
    originTag: "ОРИГИНАЛЬНЫЙ ПЕРСОНАЖ",
    initialStats: {
      ...DEFAULT_STATS,
      ...(source.initialStats || {}),
    },
    lorebook: Array.isArray(source.lorebook)
      ? source.lorebook.map((entry: any) => ({
          id: newId(),
          keys: Array.isArray(entry?.keys) ? entry.keys : ["память"],
          content: entry?.content || "",
          isActive: true,
        }))
      : [],
  };
}

// ------------------------------------------------------------------
// Групповой генератор: 2–4 героя одной сцены + общий опенинг
// ------------------------------------------------------------------

export const GROUP_SIZE_MIN = 2;
export const GROUP_SIZE_MAX = 4;

/** Ограничивает размер группы допустимым диапазоном. */
export function clampGroupSize(size: number): number {
  if (!Number.isFinite(size)) return GROUP_SIZE_MIN;
  return Math.min(GROUP_SIZE_MAX, Math.max(GROUP_SIZE_MIN, Math.round(size)));
}

/** Инструкция для модели: собрать группу героев и общий опенинг сцены. */
export function buildGroupInstruction(
  gender: "female" | "male" | "any",
  selectedTags: string[],
  customIdea: string,
  size: number
): string {
  const count = clampGroupSize(size);

  const genderPrompt =
    gender === "female"
      ? "Все персонажи — девушки (женский пол)."
      : gender === "male"
      ? "Все персонажи — парни (мужской пол)."
      : "Пол каждого персонажа — на усмотрение модели.";

  const tagsList =
    selectedTags.length > 0
      ? selectedTags.join(", ")
      : "Повседневность, Разговорный / Бытовой";

  return `Ты — ведущий нарративный дизайнер и специалист по живому диалоговому AI RolePlay.
Твоя задача — собрать СЦЕНУ из ${count} персонажей для ролевой игры на русском языке: у каждого свой характер и голос, но всех связывает одна завязка.

ВХОДНЫЕ ПАРАМЕТРЫ:
- ${genderPrompt}
- Выбранные теги, стиль речи и сеттинг: ${tagsList}
${customIdea.trim() ? `- Особая авторская задумка: "${customIdea.trim()}"` : ""}

ПРАВИЛА ГРУППЫ (КРИТИЧЕСКИ ВАЖНО):
1. Персонажи должны звучать РАЗНО: разный темперамент, манера речи, отношение к игроку. Никаких близнецов по характеру.
2. Между ними есть живые связи: дружба, соперничество, тайная симпатия, долг, старая обида. Взаимные чувства и конфликты важнее внешности.
3. ПИШИ ЁМКО И КОНЦЕНТРАЦИРОВАННО, без воды и высокопарных клише XIX века.
4. Опенинг — общая сцена: где все ${count} героя вместе с игроком, что происходит, кто что делает. Он должен дать игроку повод вмешаться, а не закрыть сцену.

ТРЕБОВАНИЯ К ПОЛЯМ КАЖДОГО ПЕРСОНАЖА (ОБЪЁМ СТРОГО, БЕЗ ВОДЫ):
- name: звучное, естественное имя или прозвище.
- tagline: 1-3 слова сути («Дерзкая соседка», «Циничный напарник»).
- description: 1-2 плотных предложения (внешность, одежда, примета).
- personality: 2-3 предложения (психотип, привычки, слабости, триггеры).
- scenario: 1-2 предложения (как он оказался вместе с остальными).
- systemPrompt: 2 строгие директивы для ИИ (манера речи, реакции на эмоции).
- firstMessage: 1 предложение — первая реплика героя в этой сцене (*действия в звёздочках*, речь через тире).
- lorebook: 1-2 коротких ключевых факта (по 1 предложению).

ОТВЕТ ДОЛЖЕН БЫТЬ СТРОГО В ФОРМАТЕ ВАЛИДНОГО JSON:
{
  "opening": "Общий опенинг сцены: 3-5 предложений, где все герои вместе с игроком (*действия в звёздочках*, речь через тире).",
  "characters": [
    {
      "name": "Имя",
      "tagline": "Краткий статус",
      "description": "Внешность (2-3 предложения)",
      "personality": "Характер и психотип (3-4 предложения)",
      "scenario": "Как оказался в сцене (2-3 предложения)",
      "systemPrompt": "Инструкции стиля общения (2-3 директивы)",
      "firstMessage": "*Действие...* — Первая реплика в сцене.",
      "initialStats": {
        "trust": 30,
        "affection": 20,
        "closeness": 15,
        "tension": 25,
        "conflict": 0,
        "statusTitle": "Первая встреча"
      },
      "lorebook": [
        { "keys": ["ключ1", "ключ2"], "content": "Короткий факт или тайна персонажа", "isActive": true },
        { "keys": ["ключ3", "ключ4"], "content": "Второй ключевой факт", "isActive": true }
      ]
    }
  ]
}`;
}

/** Разбирает ответ модели в группу: карточки + общий опенинг. */
export function parseGeneratedGroup(parsed: any, selectedTags: string[]): GeneratedGroup {
  // Модели называют список по-разному и иногда отдают одного героя объектом.
  const listCandidate =
    parsed?.characters ?? parsed?.heroes ?? parsed?.cast ?? parsed?.group;

  const dictValues =
    listCandidate && typeof listCandidate === "object" && !Array.isArray(listCandidate)
      ? Object.values(listCandidate as Record<string, any>).filter(
          (item) => item && typeof item === "object"
        )
      : [];

  const rawList = Array.isArray(listCandidate)
    ? listCandidate
    : dictValues.some((item: any) => item.name || item.personality)
    ? dictValues
    : listCandidate && typeof listCandidate === "object"
    ? [listCandidate]
    : Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && (parsed.name || parsed.firstMessage)
    ? [parsed]
    : [];

  const characters = rawList
    .filter((item: any) => item && typeof item === "object")
    .slice(0, GROUP_SIZE_MAX)
    .map((item: any) => normalizeGeneratedCharacter(item, selectedTags));

  const opening =
    typeof parsed?.opening === "string" && parsed.opening.trim()
      ? parsed.opening.trim()
      : characters[0]?.firstMessage || "*Сцена начинается с тишины…*";

  return { characters, opening };
}

/**
 * Запасной путь: модель не умеет отдать группу одним JSON — собираем её по
 * одному герою, передавая каждому уже придуманных соседей по сцене.
 */
async function generateGroupOneByOne(
  apiConfig: ApiConfig,
  gender: "female" | "male" | "any",
  selectedTags: string[],
  customIdea: string,
  count: number
): Promise<GeneratedGroup> {
  const characters: Partial<Character>[] = [];

  for (let index = 0; index < count; index += 1) {
    const neighbours = characters
      .map((item) => `${item.name} — ${item.tagline || item.personality || "без подробностей"}`)
      .join("; ");

    const idea = [
      customIdea.trim(),
      `Это участник №${index + 1} из ${count} в одной общей сцене.`,
      neighbours
        ? `Он уже в сцене с: ${neighbours.slice(0, 300)}. Придумай живые отношения с ними.`
        : "",
      "Характер и манера речи должны отличаться от остальных участников сцены.",
    ]
      .filter(Boolean)
      .join(" ");

    characters.push(
      await generateAiCharacter(apiConfig, gender, selectedTags, idea)
    );
  }

  const opening = await requestGroupOpening(apiConfig, characters);

  return { characters, opening };
}

/** Просит у модели общий опенинг уже придуманной группы. */
async function requestGroupOpening(
  apiConfig: ApiConfig,
  characters: Partial<Character>[]
): Promise<string> {
  const roster = characters
    .map((item) => `- ${item.name}: ${item.tagline || item.personality || ""}`)
    .join("\n");

  try {
    const parsed = await requestModelJson(
      apiConfig,
      `Ты — ведущий нарративный дизайнер ролевой сцены на русском языке.
Герои уже придуманы:
${roster}

Напиши ОБЩИЙ ОПЕНИНГ сцены: 3-5 предложений, где все они вместе с игроком (*действия в звёздочках*, прямая речь через тире). Опиши место, момент и то, что заставляет игрока вмешаться.

ОТВЕТ СТРОГО В ФОРМАТЕ JSON: { "opening": "текст опенинга" }`,
      900
    );

    if (typeof parsed?.opening === "string" && parsed.opening.trim()) {
      return parsed.opening.trim();
    }
  } catch {
    // Не страшно: сцену откроем простой ремаркой ниже.
  }

  const names = characters
    .map((item) => item.name || "герой")
    .join(", ");

  return `*${names} — все здесь, в одной сцене. Разговор начинается с тишины, которую каждый готов нарушить по-своему.*`;
}

/** Генерирует группу из 2–4 героев вместе с общим опенингом сцены. */
export async function generateAiGroup(
  apiConfig: ApiConfig,
  gender: "female" | "male" | "any",
  selectedTags: string[],
  customIdea: string,
  size: number
): Promise<GeneratedGroup> {
  const count = clampGroupSize(size);
  const instruction = buildGroupInstruction(gender, selectedTags, customIdea, count);
  // Потолок под ответ: карточки длинные, но провайдеры не любят огромных лимитов.
  const maxTokens = Math.min(6000, 2200 + count * 700);

  // Второй заход на случай, когда модель ушла в рассуждения или отдала
  // одного героя вместо группы.
  const strictInstruction = `${instruction}

ВАЖНО: отвечай ОДНИМ JSON-объектом и ничем больше. Не рассуждай, не пиши пояснений и markdown — начни ответ с { и закончи }. В массиве "characters" должно быть ровно ${count} персонажа.`;

  async function requestGroup(): Promise<GeneratedGroup> {
    try {
      return parseGeneratedGroup(
        await requestModelJson(apiConfig, instruction, maxTokens),
        selectedTags
      );
    } catch (cause) {
      if (!(cause instanceof ModelJsonError)) throw cause;
    }

    return parseGeneratedGroup(
      await requestModelJson(apiConfig, strictInstruction, maxTokens),
      selectedTags
    );
  }

  let group: GeneratedGroup;

  try {
    group = await requestGroup();

    if (group.characters.length < GROUP_SIZE_MIN) {
      group = parseGeneratedGroup(
        await requestModelJson(apiConfig, strictInstruction, maxTokens),
        selectedTags
      );
    }

    if (group.characters.length >= GROUP_SIZE_MIN) return group;
  } catch (cause) {
    if (!(cause instanceof ModelJsonError)) throw cause;
  }

  // Модель так и не отдала группу одним ответом — собираем её по одному герою.
  const fallback = await generateGroupOneByOne(
    apiConfig,
    gender,
    selectedTags,
    customIdea,
    count
  );

  if (fallback.characters.length < GROUP_SIZE_MIN) {
    throw new Error(
      `Не удалось собрать группу из ${count} героев. Попробуйте ещё раз или уменьшите размер группы.`
    );
  }

  return fallback;
}

/** Запрос к модели в JSON-режиме: Gemini или OpenAI-совместимый эндпоинт. */
async function requestModelJson(
  apiConfig: ApiConfig,
  systemInstruction: string,
  maxTokens = 2500
): Promise<any> {
  let rawJson = "";

  if (apiConfig.mode === "gemini") {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${apiConfig.model || "gemini-2.0-flash"}:generateContent?key=${apiConfig.apiKey}`;
    const res = await fetchFromProvider(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: systemInstruction }] }],
          generationConfig: {
            temperature: 0.85,
            maxOutputTokens: maxTokens,
            responseMimeType: "application/json",
          },
        }),
      },
      apiConfig,
      { useProxy: false }
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        formatApiError(null, res.status, errText, apiConfig.baseUrl, apiConfig.model)
      );
    }
    const data = await readJsonResponse(res);
    rawJson = extractModelText(data);
  } else {
    const { isOllama, primaryUrl, fallbackUrl } = resolveEndpoints(apiConfig.baseUrl);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiConfig.apiKey && apiConfig.apiKey.trim().length > 0) {
      headers["Authorization"] = `Bearer ${apiConfig.apiKey.trim()}`;
    }

    const bodyPayload: Record<string, any> = {
      model: apiConfig.model || (isOllama ? "qwen3.5:9b-q8_0" : "openai/gpt-4o-mini"),
      messages: [{ role: "user", content: systemInstruction }],
      temperature: 0.85,
      stream: false,
    };

    if (isOllama) {
      bodyPayload.think = false;
      bodyPayload.format = "json";
      bodyPayload.options = {
        temperature: 0.85,
        num_ctx: apiConfig.localNumCtx ?? 8192,
      };
    } else {
      bodyPayload.max_tokens = maxTokens;
      bodyPayload.response_format = { type: "json_object" };
    }

    let res = await fetchFromProvider(
      primaryUrl,
      {
        method: "POST",
        headers,
        body: JSON.stringify(bodyPayload),
      },
      apiConfig
    );

    if (!res.ok && res.status === 404 && fallbackUrl) {
      const fallbackRes = await fetchFromProvider(
        fallbackUrl,
        {
          method: "POST",
          headers,
          body: JSON.stringify(bodyPayload),
        },
        apiConfig
      );
      if (fallbackRes.ok) res = fallbackRes;
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        formatApiError(null, res.status, errText, apiConfig.baseUrl, apiConfig.model)
      );
    }
    const data = await readJsonResponse(res);
    rawJson = extractModelText(data);
  }

  return parseModelJson(rawJson);
}
