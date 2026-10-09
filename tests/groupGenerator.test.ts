import { afterEach, describe, expect, it, vi } from "vitest";
import { blueprintToGeneratedGroup, generateGroupBlueprint, regenerateGroupSection } from "../src/services/groupGenerator/generator";
import { upgradeLegacyGroup, validateGroupBlueprint } from "../src/services/groupGenerator/schema";
import type { ApiConfig } from "../src/types";
import type { GroupBlueprint, GroupPreferences } from "../src/services/groupGenerator/types";

const apiConfig: ApiConfig = {
  mode: "openai",
  baseUrl: "https://api.ru-openrouter.ru/v1",
  apiKey: "test-key",
  model: "test-model",
  temperature: 0.8,
  contextWindow: 20,
  streamEnabled: false,
};

const preferences: GroupPreferences = {
  size: 2,
  gender: "any",
  ageBandId: "adult_mixed",
  customIdea: "Ночная смена в маленьком отеле.",
  uniqueness: 2,
  relationIntensity: "balanced",
  adultEnabled: false,
  selections: { setting: ["shared_place"], ensemble: ["regulars"] },
};

function character(key: string, name: string, gender: "female" | "male", age: number) {
  return {
    key,
    name,
    gender,
    age,
    role: name === "Мира" ? "дежурная администраторка" : "курьер, который задержался в холле",
    tagline: name === "Мира" ? "Ночная администраторка" : "Курьер с плохой памятью",
    appearance: `${name} заметен(а) по спокойной пластике и одной практичной детали одежды.`,
    personality: name === "Мира" ? "Собранная, суховатая, но не без любопытства." : "Импульсивный, наблюдательный и неловко честный.",
    publicPersona: "Старается выглядеть собранно, даже когда план меняется.",
    privateLayer: "Не делится первой версией своих мотивов.",
    strengths: ["наблюдательность"],
    flaws: ["торопится с выводами"],
    wants: ["закончить свою смену без лишних проблем"],
    boundaries: ["не любит, когда за него решают"],
    speech: {
      register: "разговорный, без пафоса",
      rhythm: name === "Мира" ? "короткие точные фразы" : "сбивчивый ритм с внезапными уточнениями",
      markers: ["пауза перед ответом"],
      examples: [name === "Мира" ? "— Давайте по порядку." : "— Подождите, это важно.", "— Я не это имел в виду."],
    },
    scenarioRole: "У каждого своя причина задержаться в отеле этой ночью.",
    behaviorRules: ["сначала наблюдает", "не соглашается автоматически"],
    facts: ["Знает практическую сторону места."],
    firstMessage: name === "Мира" ? "*Закрывает журнал.* — Кто ещё не собирается спать?" : "*Снимает капюшон.* — Кажется, я принёс не тот ключ.",
    initialStats: {
      trust: 34,
      affection: 20,
      closeness: 15,
      tension: 26,
      conflict: 4,
      statusTitle: "Первое пересечение",
    },
  };
}

function blueprint(overrides: Partial<GroupBlueprint> = {}): GroupBlueprint {
  return {
    version: 1,
    scene: {
      title: "Последний номер",
      setting: "маленький отель у закрытой трассы",
      premise: "Двое задержались в холле по разным причинам.",
      currentMoment: "На стойке обнаруживается ключ без номера.",
      tone: "тихое бытовое напряжение",
      hook: "Можно спросить, кому принадлежит ключ, или дать героям самим поспорить.",
      boundaries: ["не форсировать романтику"],
    },
    cast: [character("mira", "Мира", "female", 31), character("lev", "Лев", "male", 27)],
    relations: [{
      fromKey: "mira",
      toKey: "lev",
      label: "настороженное сотрудничество",
      history: "Лев уже однажды оставил после себя путаницу в журнале.",
      currentDynamic: "Мира хочет проверить его слова, а Лев пытается заслужить ещё один шанс.",
    }],
    opening: "*В холле пахнет мокрой шерстью и кофе. Мира листает журнал, Лев держит найденный ключ, но оба пока говорят не с игроком, а друг с другом.*",
    ...overrides,
  };
}

function providerResponse(payload: unknown): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Group DNA schema", () => {
  it("строго принимает полноценный blueprint и переносит relations по стабильным ключам", () => {
    const result = validateGroupBlueprint(blueprint(), 2);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blueprint.cast.map((item) => item.key)).toEqual(["mira", "lev"]);
    expect(result.blueprint.relations[0].fromKey).toBe("mira");
    expect(result.blueprint.cast[0].speech.examples).toHaveLength(2);
  });

  it("не маскирует отсутствующие обязательные слои безопасными defaults", () => {
    const invalid = blueprint({
      cast: [
        { ...character("mira", "Мира", "female", 31), key: "" },
        { ...character("lev", "Лев", "male", 27), speech: undefined as never, wants: [] },
      ],
      scene: { ...blueprint().scene, premise: "" },
      relations: [],
    });
    const result = validateGroupBlueprint(invalid, 2);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.join(" ")).toMatch(/key|speech|wants|scene\.premise|relations/);
  });

  it("поднимает старый characters/opening payload только на compatibility path", () => {
    const legacy = {
      characters: [
        { name: "Мира", tagline: "Администраторка", personality: "Собранная.", description: "В форме.", scenario: "На смене.", firstMessage: "— Добрый вечер." },
        { name: "Лев", tagline: "Курьер", personality: "Торопливый.", description: "С рюкзаком.", scenario: "Привёз посылку.", firstMessage: "— Я только на минуту." },
      ],
      opening: "*В холле встречаются двое.* — Кто здесь?",
    };
    const upgraded = upgradeLegacyGroup(legacy, 2);
    const result = validateGroupBlueprint(upgraded, 2);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blueprint.opening).toContain("Кто здесь");
    expect(result.blueprint.cast[0].speech.examples[0]).toContain("Добрый вечер");
  });
});

describe("Group DNA provider pipeline", () => {
  it("делает ровно один correction retry и возвращает совместимые drafts", async () => {
    const invalid = {
      ...blueprint(),
      cast: blueprint().cast.map((item) => ({ ...item, speech: { ...item.speech, examples: [] } })),
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(providerResponse(invalid))
      .mockResolvedValueOnce(providerResponse(blueprint()));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateGroupBlueprint(apiConfig, preferences);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.corrected).toBe(true);
    expect(result.group.characters).toHaveLength(2);
    expect(result.group.characters[0].groupKey).toBe("mira");
    expect(result.group.relations?.[0]).toMatchObject({ fromKey: "mira", toKey: "lev" });
    expect(result.group.characters[0].systemPrompt).toContain("NPC могут автономно говорить друг с другом");
  });

  it("частичная регенерация меняет только выбранную секцию и не теряет cast", async () => {
    const previous = blueprint();
    const next = blueprint({
      opening: "*Лампа над стойкой мигает. Мира и Лев спорят о найденном ключе, оставляя игроку свободный вход в разговор.*",
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(providerResponse(next)));

    const result = await regenerateGroupSection(apiConfig, preferences, previous, "opening");

    expect(result.blueprint.opening).toContain("Лампа над стойкой");
    expect(result.blueprint.scene).toEqual(previous.scene);
    expect(result.blueprint.cast.map((item) => item.key)).toEqual(["mira", "lev"]);
    expect(result.blueprint.relations).toEqual(previous.relations);
  });

  it("перегенерирует одного героя, не отсоединяя остальных и их relations", async () => {
    const previous = blueprint();
    const next = blueprint({
      cast: [
        { ...previous.cast[0], name: "Мира Ночная", personality: "Теперь она заметно прямее формулирует просьбы." },
        previous.cast[1],
      ],
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(providerResponse(next)));

    const result = await regenerateGroupSection(apiConfig, preferences, previous, "cast", "mira");

    expect(result.blueprint.cast[0].name).toBe("Мира Ночная");
    expect(result.blueprint.cast[1]).toEqual(previous.cast[1]);
    expect(result.blueprint.relations).toEqual(previous.relations);
  });

  it("адаптер не раскрывает private layer в карточке, а сохраняет его в systemPrompt", () => {
    const result = blueprintToGeneratedGroup(blueprint());
    const card = result.characters[0];

    expect(card.groupKey).toBe("mira");
    expect(card.systemPrompt).toContain("ЛИЧНЫЙ СЛОЙ");
    expect(card.systemPrompt).toContain("не делай их общим знанием NPC");
    expect(card.firstMessage).toContain("Закрывает журнал");
  });
});
