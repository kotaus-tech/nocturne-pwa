import { newId } from "../utils/id";
import type { ApiConfig, Character, RelationshipStats } from "../types";
import { DEFAULT_STATS } from "../types";

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

  const tagsList = selectedTags.length > 0 ? selectedTags.join(", ") : "Повседневность, Романтическое сближение";

  const systemInstruction = `Ты — элитный нарративный дизайнер и сценарист визуальных новелл (в стиле SillyTavern / Character.AI).
Твоя задача — создать глубокого, живого, харизматичного и невероятно интересного персонажа для текстовой ролевой игры на русском языке.

ВХОДНЫЕ ПАРАМЕТРЫ:
- ${genderPrompt}
- Выбранные теги и направления: ${tagsList}
${customIdea.trim() ? `- Особая задумка автора: "${customIdea.trim()}"` : ""}

ТРЕБОВАНИЯ:
1. Имя: звучное, естественное и запоминающееся.
2. Tagline (статус): 1-3 слова, отражающие суть (например: «Дерзкая соседка», «Холодный наставник»).
3. Personality (Характер): подробно распиши психотип, манеру речи, скрытые уязвимости, привычки и триггеры.
4. Scenario (Сценарий / Контекст): опиши точку старта, где и как они оказались вместе с пользователем, почему возникла искра/конфликт.
5. Description (Внешность): рост, телосложение, глаза, волосы, одежда, запахи и особые приметы.
6. FirstMessage (Первое сообщение): кинематографичный литературный опенинг от первого лица персонажа (*действия выделяй звёздочками*, прямая речь в кавычках или через тире), который сразу втягивает в диалог и ставит игрока перед интересным выбором/вопросом.
7. Lorebook: 2-3 записи ключевых фактов/воспоминаний персонажа.
8. InitialStats: стартовые шкалы отношений (0-100) и стартовый титул отношений.

ОТВЕТ ДОЛЖЕН БЫТЬ СТРОГО В ФОРМАТЕ ЧИСТОГО JSON БЕЗ ЛИШНЕГО ТЕКСТА:
{
  "name": "Имя",
  "tagline": "Краткий статус",
  "description": "Описание внешности и стиля",
  "personality": "Характер, манеры, слабости",
  "scenario": "Сценарий и контекст встречи",
  "systemPrompt": "",
  "firstMessage": "*Действие...* — Реплика персонажа.",
  "initialStats": {
    "trust": 30,
    "affection": 20,
    "closeness": 15,
    "tension": 25,
    "conflict": 0,
    "statusTitle": "Первая встреча"
  },
  "lorebook": [
    { "keys": ["ключ1", "ключ2"], "content": "Тайное воспоминание или факт о персонаже", "isActive": true }
  ]
}`;

  let rawJson = "";

  if (apiConfig.mode === "gemini") {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${apiConfig.model || "gemini-2.0-flash"}:generateContent?key=${apiConfig.apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: systemInstruction }] }],
        generationConfig: {
          temperature: 0.85,
          responseMimeType: "application/json",
        },
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini API Error: ${err}`);
    }
    const data = await res.json();
    rawJson = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  } else {
    // OpenAI / OpenRouter / DeepSeek
    const res = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: apiConfig.model || "openai/gpt-4o-mini",
        messages: [{ role: "user", content: systemInstruction }],
        temperature: 0.85,
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI API Error: ${err}`);
    }
    const data = await res.json();
    rawJson = data.choices?.[0]?.message?.content ?? "";
  }

  // Очистка и парсинг JSON
  const cleaned = rawJson.replace(/```json/gi, "").replace(/```/g, "").trim();
  const parsed = JSON.parse(cleaned);

  return {
    name: parsed.name || "Безымянный",
    tagline: parsed.tagline || "",
    description: parsed.description || "",
    personality: parsed.personality || "",
    scenario: parsed.scenario || "",
    systemPrompt: parsed.systemPrompt || "",
    firstMessage: parsed.firstMessage || "*Смотрит на тебя в тишине...*",
    initialStats: {
      ...DEFAULT_STATS,
      ...(parsed.initialStats || {}),
    },
    lorebook: Array.isArray(parsed.lorebook)
      ? parsed.lorebook.map((l: any) => ({
          id: newId(),
          keys: Array.isArray(l.keys) ? l.keys : ["память"],
          content: l.content || "",
          isActive: true,
        }))
      : [],
  };
}