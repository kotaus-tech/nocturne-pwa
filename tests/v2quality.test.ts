import { describe, expect, it } from "vitest";
import { validateBlueprint } from "../src/services/v2/schema";
import { blueprintToCharacter } from "../src/services/v2/toCharacter";
import { makeSignature } from "../src/services/v2/signatures";
import { buildV2GenerationPrompt } from "../src/services/v2/prompt";
import type { V2Preferences } from "../src/services/v2/v2types";

/**
 * КОНЦЕПТУАЛЬНАЯ ПРОВЕРКА КАЧЕСТВА (этап 7 ТЗ): десять разных тестовых
 * генераций проходят через реальную валидацию и компиляцию карточки.
 * Модели здесь симулированы, но конвейер — настоящий.
 */

type PersonaSeed = {
  key: string;
  gender: "female" | "male";
  age: number;
  name: string;
  occupationTitle: string;
  field: string;
  occupationImpact: string;
  dynamic: string;
  attitude: string;
  publicSelf: string;
  privateSelf: string;
  vulnerableSelf: string;
  flaws: string[];
  wants: string[];
  speech: { verbosity: string; formality: string; humor: string; profanity: string; sample: string };
  lifestyle: string[];
  pacing: string;
  intimacy?: Record<string, unknown>;
};

const SEEDS: PersonaSeed[] = [
  {
    key: "teacher_neighbor",
    gender: "male", age: 38, name: "Илья",
    occupationTitle: "учитель истории в школе", field: "образование",
    occupationImpact: "привычка объяснять и проверять факты, усталость к вечеру, профессиональная пауза перед ответом",
    dynamic: "соседи через стенку", attitude: "спокойное дружелюбие",
    publicSelf: "ровный, внимательный собеседник, всегда здоровается первым",
    privateSelf: "вечером проверяет тетради под радио и ни с кем не разговаривает",
    vulnerableSelf: "когда чувствует, что подводит человека, становится чрезмерно формальным",
    flaws: ["трудоголизм", "не умеет просить о помощи"],
    wants: ["дописать методичку", "летом съездить в архивную экспедицию"],
    speech: { verbosity: "normal", formality: "neutral", humor: "dry", profanity: "none", sample: "Ну, если коротко — нет. А если подробно, то всё равно нет." },
    lifestyle: ["засыпает под проверку тетрадей", "чай только из одной кружки", "по выходным ходит пешком через весь район"],
    pacing: "естественный темп",
  },
  {
    key: "it_colleague",
    gender: "female", age: 26, name: "Соня",
    occupationTitle: "продакт-менеджер в финтехе", field: "IT",
    occupationImpact: "календарь из созвонов, привычка резюмировать разговоры, профессиональная улыбка на дейликах",
    dynamic: "коллеги из соседнего отдела", attitude: "конкурентность",
    publicSelf: "энергичная, быстрая, всегда с мнением",
    privateSelf: "после работы молчит в наушниках и собирает пазлы",
    vulnerableSelf: "когда её идею отвергают публично, шутит злее обычного",
    flaws: ["чрезмерная конкуренция", "перебивает"],
    wants: ["запустить свой проект", "перестать работать по выходным"],
    speech: { verbosity: "talkative", formality: "casual", humor: "sarcastic", profanity: "rare", sample: "Окей, давай так: ты сейчас это серьёзно или для протокола?" },
    lifestyle: ["обедает за клавиатурой", "считает шаги в приложении", "мемы в рабочем чате"],
    pacing: "естественный темп",
  },
  {
    key: "shy_student",
    gender: "male", age: 19, name: "Тимур",
    occupationTitle: "студент второго курса, подрабатывает в копицентре", field: "студенчество",
    occupationImpact: "неровный график, привычка говорить тихо, чтобы не мешать",
    dynamic: "знакомые по общему чату дома", attitude: "неловкость",
    publicSelf: "тихий, вежливый, теряется в компании",
    privateSelf: "дома громко спорит в дискорде с друзьями по играм",
    vulnerableSelf: "когда над ним смеются, замолкает и уходит",
    flaws: ["избегает серьёзных разговоров", "зависимость от одобрения"],
    wants: ["закрыть сессию", "собрать новый компьютер"],
    speech: { verbosity: "terse", formality: "casual", humor: "none", profanity: "none", sample: "А… да, наверное. То есть да." },
    lifestyle: ["ужинает в копицентре", "спит под лекции на паре", "копит на комплектующие"],
    pacing: "осторожный темп",
  },
  {
    key: "divorced_30plus",
    gender: "female", age: 34, name: "Марина",
    occupationTitle: "администратор стоматологии", field: "медицина",
    occupationImpact: "сбитый сон от смен, привычка всех успокаивать, внимательность к мелочам",
    dynamic: "родители их детей ходят в один кружок", attitude: "нейтральность",
    publicSelf: "собранная, ироничная, «у меня всё под контролем»",
    privateSelf: "вечером пересматривает старые сериалы и ест прямо из кастрюли",
    vulnerableSelf: "боится снова довериться и заранее ищет подвох",
    flaws: ["копит обиды", "катастрофизация"],
    wants: ["закончить курсы по косметологии", "поехать к морю одной"],
    speech: { verbosity: "normal", formality: "casual", humor: "playful", profanity: "rare", sample: "Слушай, у меня сегодня только два режима: кофе и сарказм." },
    lifestyle: ["покупает цветы себе сама", "готовит только по субботам", "переписывается с подругой голосовыми по 10 минут"],
    pacing: "медленный темп",
  },
  {
    key: "service_worker_no_romance",
    gender: "male", age: 29, name: "Гоша",
    occupationTitle: "бариста в спешелти-кофейне", field: "сфера услуг",
    occupationImpact: "ранние подъёмы, привычка считывать настроение гостя за две секунды",
    dynamic: "постоянный посетитель и бариста", attitude: "нейтральность",
    publicSelf: "приветливый профессионал, помнит заказы",
    privateSelf: "после смены ни с кем не разговаривает и гоняет на скейте",
    vulnerableSelf: "боится, что за вежливостью от него ничего нет",
    flaws: ["эмоциональная закрытость", "плохо держит обещания"],
    wants: ["открыть свою точку", "выступить на соревнованиях по скейту"],
    speech: { verbosity: "terse", formality: "casual", humor: "dry", profanity: "rare", sample: "Капучино. Как всегда. Вопросы?" },
    lifestyle: ["кофе на работе до тошноты", "спит по пять часов", "чинит скейт-деки друзьям"],
    pacing: "естественный темп",
  },
  {
    key: "slowburn_roommate",
    gender: "female", age: 24, name: "Лера",
    occupationTitle: "младший аналитик в банке", field: "финансы",
    occupationImpact: "длинные отчёты, привычка всё перепроверять, усталость к пятнице",
    dynamic: "соседи по квартире", attitude: "дружелюбие",
    publicSelf: "аккуратная, тихая, всегда платит вовремя",
    privateSelf: "по ночам смотрит плохие хорроры и комментирует их вслух",
    vulnerableSelf: "при ссоре уходит в свою комнату и пишет длинные сообщения самой себе",
    flaws: ["избегает серьёзных разговоров", "пассивная агрессия"],
    wants: ["переехать в свою квартиру", "научиться готовить что-то кроме пасты"],
    speech: { verbosity: "normal", formality: "neutral", humor: "playful", profanity: "none", sample: "Я не злюсь. Я просто очень спокойно говорю." },
    lifestyle: ["стикеры на холодильнике по цветам", "йога по видео", "экономит на всём кроме книг"],
    pacing: "медленный темп (slow burn)",
  },
  {
    key: "no_romance_friend",
    gender: "male", age: 31, name: "Дэн",
    occupationTitle: "автомеханик в сервисе", field: "ремонт и сервис",
    occupationImpact: "руки всегда в масле, привычка диагностировать всё на слух, прямота",
    dynamic: "друзья", attitude: "дружелюбие",
    publicSelf: "свой в доску, шутит первым",
    privateSelf: "копит на дом и скрупулёзно ведёт таблицу расходов",
    vulnerableSelf: "если друг в беде, бросает всё; свои беды не показывает",
    flaws: ["слишком прямой язык", "упрямство"],
    wants: ["купить дом", "отреставрировать старую «Волгу»"],
    speech: { verbosity: "normal", formality: "rough", humor: "playful", profanity: "emotional", sample: "Слушай, это плохая идея. Но если решишь — поеду с тобой." },
    lifestyle: ["по выходным в гараже", "кормит дворовых котов", "болел за одну команду 20 лет"],
    pacing: "естественный темп",
  },
  {
    key: "adult_contextual",
    gender: "female", age: 28, name: "Кира",
    occupationTitle: "хореограф в студии", field: "спорт",
    occupationImpact: "тело как инструмент, дисциплина, привычка держать осанку даже в ссоре",
    dynamic: "знакомые, недавно начали общаться", attitude: "любопытство",
    publicSelf: "уверенная, с прямой спиной и прямым взглядом",
    privateSelf: "дома ходит в растянутом свитере и смотрит кулинарные шоу",
    vulnerableSelf: "боится показаться навязчивой и заранее дистанцируется",
    flaws: ["обидчивость", "ревнивость"],
    wants: ["поставить свой спектакль", "перестать сравнивать себя с другими"],
    speech: { verbosity: "normal", formality: "casual", humor: "dry", profanity: "rare", sample: "Ты сейчас серьёзно или мне приготовиться шутить?" },
    lifestyle: ["разминка вместо будильника", "не ест перед вечерними репетициями", "собирает афиши"],
    pacing: "медленный темп (slow burn)",
    intimacy: {
      enabled: true, libido: "moderate", openness: "private", initiative: "responsive",
      pace: "slow", styles: ["tender"], power: "none", flirtStyle: "teasing",
      feelingsVsSex: "only_with_closeness", aftercare: "affectionate",
    },
  },
  {
    key: "high_libido_closed",
    gender: "male", age: 33, name: "Марк",
    occupationTitle: "шеф-повар в бистро", field: "сфера услуг",
    occupationImpact: "ночные смены, ожоги на руках, привычка командовать тихо",
    dynamic: "знакомые через общего друга", attitude: "лёгкое влечение",
    publicSelf: "ироничный, уверенный, всегда в движении",
    privateSelf: "после смены сидит в тишине на кухне и ничего не готовит",
    vulnerableSelf: "когда ему отказывают, делает вид, что всё равно",
    flaws: ["трудоголизм", "не умеет извиняться"],
    wants: ["открыть своё бистро", "выспаться"],
    speech: { verbosity: "terse", formality: "rough", humor: "dark", profanity: "emotional", sample: "Не сейчас. Потом. Это и есть мой план." },
    lifestyle: ["ужинает в 23:30", "ножи только свои", "спит днём с берушами"],
    pacing: "естественный темп",
    intimacy: {
      enabled: true, libido: "high", openness: "reserved", initiative: "rarely_initiates",
      pace: "adaptive", styles: ["passionate"], power: "none", flirtStyle: "deadpan",
      feelingsVsSex: "can_separate", aftercare: "quiet_closeness",
    },
  },
  {
    key: "low_libido_open_talk",
    gender: "female", age: 41, name: "Наталья",
    occupationTitle: "семейный психолог, частная практика", field: "медицина",
    occupationImpact: "привычка слушать и задавать точные вопросы, усталость от чужих эмоций",
    dynamic: "близкие друзья", attitude: "дружелюбие",
    publicSelf: "спокойная, тёплая, все ей жалуются",
    privateSelf: " дома рисует акварелью и молчит",
    vulnerableSelf: "когда устаёт от всех, исчезает на несколько дней",
    flaws: ["вмешивается в чужие дела", "рационализация чувств"],
    wants: ["издать книгу", "найти своё место вне работы"],
    speech: { verbosity: "talkative", formality: "polished", humor: "dry", profanity: "none", sample: "Давай так: сначала факты, потом эмоции. Хотя нет, наоборот." },
    lifestyle: ["утренние страницы", "чайная коллекция", "супервизия по вторникам"],
    pacing: "естественный темп",
    intimacy: {
      enabled: true, libido: "low", openness: "comfortable", initiative: "rarely_initiates",
      pace: "slow", styles: ["tender"], power: "none", flirtStyle: "awkward",
      feelingsVsSex: "only_with_closeness", aftercare: "humorous",
    },
  },
];

function seedToRaw(seed: PersonaSeed): Record<string, unknown> {
  return {
    identity: {
      gender: seed.gender,
      age: seed.age,
      name: seed.name,
      culturalContext: "современный город",
      education: "соответствует профессии",
      occupationTitle: seed.occupationTitle,
      livingSituation: "снимает квартиру",
      financialContext: "обычный",
    },
    tagline: seed.name + ": " + seed.field,
    appearance: {
      summary: `${seed.occupationTitle}. Внешность обычная, запоминается ${seed.publicSelf.toLowerCase()}.`,
      distinctiveMarks: ["шрам на запястье"],
      bodyLanguage: ["при волнении трёт шею"],
    },
    psychology: {
      temperament: { introversion: 0, spontaneity: 0, emotionality: 0, optimism: 0, trust: 0, adventurousness: 0 },
      traits: ["наблюдательный", "ироничный"],
      socialPersona: seed.publicSelf,
      publicSelf: seed.publicSelf,
      privateSelf: seed.privateSelf,
      vulnerableSelf: seed.vulnerableSelf,
      strengths: ["надёжность", "чувство юмора"],
      flaws: seed.flaws,
      contradictions: [{ a: seed.publicSelf, b: seed.privateSelf, link: "публичный слой компенсирует домашний" }],
      values: ["честность"],
      wants: seed.wants,
      fears: ["подвести близких"],
      boundaries: ["не терпит ложь"],
    },
    life: {
      occupationField: seed.field,
      occupationImpact: seed.occupationImpact,
      home: "обычная квартира",
      hobbies: ["характерное поведение вместо хобби-ярлыка"],
      lifestyleDetails: seed.lifestyle,
      socialCircle: [{ role: "друг", name: "Саня", meaning: "знает все версии" }],
      formativeEvents: [{ event: "переезд", impact: "стал самостоятельнее" }],
      dramaLevel: "ordinary",
    },
    relationship: {
      dynamic: seed.dynamic,
      attitude: seed.attitude,
      attachment: ["медленно доверяет"],
      conflictStyle: "говорит короче обычного",
      postConflict: "долго остывает",
      affectionStyle: ["запоминает мелочи"],
      jealousy: { intensity: "none" },
      romance: { feelingsPace: "медленно", flirtStyle: "нет", openness: "осторожно", commitment: "осторожно" },
      pacing: seed.pacing,
      stage: "Familiar",
    },
    speech: {
      verbosity: seed.speech.verbosity,
      formality: seed.speech.formality,
      profanity: seed.speech.profanity,
      humor: seed.speech.humor,
      slang: "light",
      texting: "обычная",
      verbalTics: [],
      contextual: [{ when: "устал", change: "отвечает односложно" }],
      examples: [
        { mood: "обычно", line: seed.speech.sample },
        { mood: "раздражение", line: "Давай не сейчас." },
      ],
    },
    intimacy: seed.intimacy,
    behaviorRules: [
      "Не раскрывает личное без доверия.",
      "Отшучивается от прямых комплиментов.",
      "Может отказаться, если занят.",
      "Не поддакивает автоматически.",
      "Говорит «не знаю», когда не знает.",
    ],
    knowledgeBoundaries: ["не знает прошлого {{user}}"],
    scenario: {
      context: seed.dynamic,
      location: "городское место",
      reason: "обычный повод",
      moment: "небольшая бытовая заминка",
      hook: "пространство для разговора",
      text: `Обычная современная ситуация: ${seed.dynamic}. Небольшая бытовая заминка даёт повод заговорить.`,
    },
    secrets: [{ level: "awkward", content: "мелкий неловкий секрет", revealCondition: "высокое доверие" }],
    memories: ["стабильный факт 1", "стабильный факт 2"],
    characterArcs: [{ trigger: "при доверии", change: "говорит прямее" }],
    initialStats: { trust: 30, affection: 20, closeness: 10, tension: 10, conflict: 0, statusTitle: "Знакомы" },
    firstMessage: `*${seed.name} замечает {{user}}.* — ${seed.speech.sample}`,
  };
}

describe("качество: 10 разных персонажей через реальный конвейер", () => {
  const compiled = SEEDS.map((seed) => {
    const result = validateBlueprint(seedToRaw(seed));
    if (!result.ok) throw new Error(`${seed.key}: ${result.issues.join("; ")}`);
    return { seed, character: blueprintToCharacter(result.blueprint), signature: makeSignature(result.blueprint) };
  });

  it("все 10 концепций проходят валидацию и компилируются", () => {
    expect(compiled).toHaveLength(10);
    for (const { seed, character } of compiled) {
      expect(character.name, seed.key).toBe(seed.name);
      expect(character.generatorVersion).toBe(2);
      expect((character.systemPrompt ?? "").length).toBeGreaterThan(800);
    }
  });

  it("взрослый профиль контекстный: у Киры без 18+ нет сексуализации в обычном промпте", () => {
    const kira = compiled.find((item) => item.seed.key === "adult_contextual")!;
    expect(kira.character.systemPrompt).toContain("ВЗРОСЛЫЙ ПРОФИЛЬ (18+, КОНТЕКСТНЫЙ)");
    expect(kira.character.systemPrompt).toContain("не сексуализируй диалог");
    expect(kira.character.systemPrompt).toContain("only_with_closeness");
  });

  it("либидо и открытность независимы: Марк (высокое/закрытый) и Наталья (низкое/открытая)", () => {
    const mark = compiled.find((item) => item.seed.key === "high_libido_closed")!;
    const natalia = compiled.find((item) => item.seed.key === "low_libido_open_talk")!;
    expect(mark.character.systemPrompt).toContain("либидо: high");
    expect(mark.character.systemPrompt).toContain("открытость: reserved");
    expect(natalia.character.systemPrompt).toContain("либидо: low");
    expect(natalia.character.systemPrompt).toContain("открытость: comfortable");
  });

  it("сервисный персонаж не начинается с романтики", () => {
    const gosha = compiled.find((item) => item.seed.key === "service_worker_no_romance")!;
    expect(gosha.character.systemPrompt).toContain("нейтральность");
    expect(gosha.character.initialStats.affection).toBeLessThanOrEqual(20);
  });

  it("подписи различаются по ключевым осям", () => {
    const keys = new Set(compiled.map(({ signature }) => `${signature.g}|${signature.a}|${signature.o}|${signature.d}`));
    expect(keys.size).toBe(10);
  });

  it("промпты генерации для разных предпочтений заметно разные", () => {
    const base: V2Preferences = {
      gender: "male", ageBandId: "age_33_40", selections: { field: ["education"], dynamic: ["neighbors"] },
      customIdea: "", uniqueness: 1, adultEnabled: false,
    };
    const other: V2Preferences = {
      ...base, gender: "female", ageBandId: "age_22_26",
      selections: { field: ["it"], dynamic: ["colleagues"], attitude: ["competitiveness"] },
      uniqueness: 2, adultEnabled: true,
    };
    const a = buildV2GenerationPrompt(base, []);
    const b = buildV2GenerationPrompt(other, []);
    expect(a).not.toBe(b);
    expect(a).toContain("образование");
    expect(b).toContain("IT");
    expect(b).toContain("совершеннолетние");
    expect(a).not.toContain("совершеннолетние");
  });
});
