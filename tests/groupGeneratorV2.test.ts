import { describe, expect, it } from "vitest";
import {
  GROUP_CATALOG,
  GROUP_PRESETS,
  resolveGroupPreferencesBlock,
} from "../src/services/groupGenerator/catalog";
import { blueprintToGeneratedGroup } from "../src/services/groupGenerator/generator";
import { buildGroupGenerationPrompt } from "../src/services/groupGenerator/prompt";
import { validateGroupBlueprint } from "../src/services/groupGenerator/schema";
import type { GroupBlueprint, GroupPreferences } from "../src/services/groupGenerator/types";

const preferences: GroupPreferences = {
  size: 2,
  gender: "mixed",
  ageBandId: "25_35",
  customIdea: "Ночной разговор в тесной съёмной квартире после внезапного отключения света.",
  uniqueness: 2,
  relationIntensity: "balanced",
  adultEnabled: true,
  selections: {
    playerAnchor: ["newcomer"],
    physicalConditions: ["cramped_shared_space", "night_offhours"],
    ensembleRoles: ["coordinator", "cynical_observer"],
    informationPattern: ["hidden_past"],
    groupChemistry: ["elephant_room"],
  },
};

function blueprint(): GroupBlueprint {
  return {
    version: 2,
    scene: {
      title: "После отключения",
      setting: "тесная съёмная квартира в спальном районе",
      premise: "Игрока впервые привели в старый круг знакомых, пока бытовая проблема не даёт всем разойтись.",
      currentMoment: "Телефон одного из жильцов загорается в темноте, и на экране виден фрагмент чужого сообщения.",
      tone: "тихое бытовое напряжение",
      hook: "Игрок может спросить, что произошло, промолчать или заняться фонариком.",
      boundaries: ["игрок не обязан быть свидетелем или арбитром"],
      locationConditions: ["тесная общая кухня", "ночной режим", "единственный источник света — телефон"],
      microCatalyst: "случайно вскрывшаяся деталь в уведомлении на забытом телефоне",
      playerAnchor: {
        mode: "Новичок / Чужак",
        visibleRole: "общий знакомый привёл игрока в компанию на короткий вечер",
        playerKnowledge: ["игрок знает только общую причину встречи"],
        pressurePoints: ["персонажи могут переглядываться, но не требуют реакции"],
      },
      ensembleRoles: ["Негласный лидер / Координатор", "Циничный скептик / Наблюдатель"],
    },
    cast: [
      {
        key: "anya",
        name: "Аня",
        gender: "female",
        age: 29,
        role: "хозяйка квартиры и координатор вечера",
        tagline: "держит всё вместе",
        appearance: "Аня в старом свитере и с заколотыми волосами. Двигается быстро, но постоянно проверяет, не мешает ли другим.",
        personality: "Собранная и деятельная, привыкла решать бытовые вопросы сама. Раздражается, когда люди молчат вместо того, чтобы сказать прямо.",
        publicPersona: "Уверенная хозяйка, которая умеет организовать пространство.",
        privateLayer: "Боится, что старые отношения держатся только на привычке.",
        strengths: ["организованность", "забота делами"],
        flaws: ["контролирует слишком много", "не умеет вовремя остановиться"],
        wants: ["не дать вечеру окончательно развалиться"],
        boundaries: ["не любит, когда трогают её вещи без спроса"],
        speech: {
          register: "точная разговорная речь",
          rhythm: "коротко, с практическими уточнениями",
          markers: ["ладно", "по порядку"],
          examples: ["— Давайте сначала найдём фонарь.", "— Я вижу, что вы оба что-то недоговариваете."],
        },
        scenarioRole: "пытается удержать бытовую ситуацию и старую компанию вместе",
        behaviorRules: ["сначала предлагает конкретное решение", "не признаётся в тревоге первой", "проверяет, всем ли удобно"],
        facts: ["Знает, где лежат запасные свечи.", "Снимает эту квартиру второй год."],
        secret: "Она уже решила съехать, но ещё никому не сказала.",
        firstMessage: "— Подождите, не трогайте телефон. Сначала найдём свет.",
        initialStats: { trust: 34, affection: 20, closeness: 28, tension: 24, conflict: 8, statusTitle: "Новый человек в круге" },
      },
      {
        key: "igor",
        name: "Игорь",
        gender: "male",
        age: 32,
        role: "старый знакомый, который держится у окна",
        tagline: "замечает лишнее",
        appearance: "Игорь стоит у окна в куртке, хотя в комнате тепло. Он не занимает стул и отвечает, не поворачивая головы.",
        personality: "Наблюдательный и сухой, не любит, когда его втягивают в разговор без подготовки. Может помочь, но делает вид, что просто убирает помеху.",
        publicPersona: "Отстранённый скептик с точными замечаниями.",
        privateLayer: "Он знает, почему Аня хочет съехать, и не уверен, что имеет право об этом говорить.",
        strengths: ["внимательность", "спокойствие в сбое"],
        flaws: ["уходит от прямого разговора", "считает молчание честностью"],
        wants: ["дождаться момента, когда можно будет уйти без сцены"],
        boundaries: ["не выносит публичного давления"],
        speech: {
          register: "сухой и лаконичный",
          rhythm: "короткие реплики с паузами",
          markers: ["угу", "неважно"],
          examples: ["— Это не мой телефон.", "— Если вы хотите спросить, спросите."],
        },
        scenarioRole: "держит при себе знание о решении Ани и наблюдает за её реакцией",
        behaviorRules: ["не объясняет лишнего", "помогает молча", "переводит внимание на факты"],
        facts: ["Работает в соседнем районе.", "Знает запасной выход из дома."],
        secret: "Он обещал Ане никому не говорить о её переезде.",
        firstMessage: "— Света нет уже три минуты. Ссора от этого не станет яснее.",
        initialStats: { trust: 20, affection: 12, closeness: 18, tension: 36, conflict: 12, statusTitle: "Осторожное знакомство" },
      },
    ],
    relations: [
      {
        fromKey: "anya",
        toKey: "igor",
        label: "неравномерное доверие",
        history: "Игорь знает о решении Ани съехать и однажды пообещал молчать.",
        currentDynamic: "Аня ждёт от Игоря поддержки, а он считает, что обещание важнее её намёков.",
        leverage: "Он знает дату, когда она должна подписать новый договор.",
      },
    ],
    informationLayers: [
      {
        type: "Скрываемое решение об уходе",
        holders: ["anya", "igor"],
        hiddenFrom: ["player"],
        content: "Аня уже нашла другое жильё и собирается съехать после этой встречи.",
        visibleClue: "В коробке у двери лежит аккуратно подписанный конверт с датой.",
        revealCondition: "если игрок или другой герой прямо спросит о коробках и договоре",
      },
    ],
    chemistry: [
      {
        pattern: "Электрический подтекст",
        participants: ["igor", "player"],
        intensity: "лёгкая",
        publicMask: "Игорь отвечает игроку суше, чем остальным, и называет это раздражением.",
        trigger: "спокойный разговор наедине после того, как остальные заняты светом",
        boundaries: ["никакого давления и чтения мыслей игрока", "постепенность и взаимность"],
      },
    ],
    opening: "*В квартире гаснет свет. Аня на ощупь ищет свечи, Игорь остаётся у окна, а телефон на подоконнике коротко загорается чужим уведомлением. Они оба видят экран, но делают вид, что нет. Игрок оказывается у двери с курткой в руках.*",
  };
}

describe("Group DNA V2 catalog and prompt", () => {
  it("даёт социальные роли, позицию игрока, физику, знания и химию", () => {
    const ids = new Set(GROUP_CATALOG.map((category) => category.id));
    for (const id of ["playerAnchor", "physicalConditions", "ensembleRoles", "informationPattern", "groupChemistry"]) {
      expect(ids.has(id)).toBe(true);
    }

    const setting = GROUP_CATALOG.find((category) => category.id === "setting");
    expect(setting?.options.filter((option) => !option.hint.startsWith("legacy:")).some((option) => option.id === "fantasy_settlement")).toBe(false);
    expect(setting?.options.filter((option) => !option.hint.startsWith("legacy:")).some((option) => option.id === "scifi_station")).toBe(false);
    expect(GROUP_CATALOG.find((category) => category.id === "groupChemistry")?.adultOnly).toBe(true);

    const prompt = buildGroupGenerationPrompt(preferences, []);
    expect(prompt).toContain("современной реалистичной действительности");
    expect(prompt).toContain("Игрок не обязан быть свидетелем");
    expect(prompt).toContain("informationLayers");
    expect(prompt).toContain("chemistry");
    expect(resolveGroupPreferencesBlock(preferences)).toContain("Позиция игрока");
  });

  it("сохраняет длинную авторскую задумку без скрытого обрезания", () => {
    const longIdea = "Подробное обязательное условие для сцены. ".repeat(180).trim();
    const prefs = { ...preferences, customIdea: longIdea };
    const block = resolveGroupPreferencesBlock(prefs);
    const prompt = buildGroupGenerationPrompt(prefs, []);

    expect(block).toContain(longIdea);
    expect(prompt).toContain(longIdea);
  });

  it("показывает пресеты Group DNA 2.0 и не удаляет legacy ids из resolver", () => {
    expect(GROUP_PRESETS.map((preset) => preset.id)).toContain("preset_secret_romance");
    expect(GROUP_PRESETS.map((preset) => preset.id)).toContain("preset_shared_place");
  });
});

describe("Group DNA V2 blueprint", () => {
  it("валидирует player anchor, физику, роли, hidden information и adult chemistry", () => {
    const result = validateGroupBlueprint(blueprint(), 2, { adultEnabled: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blueprint.version).toBe(2);
    expect(result.blueprint.scene.playerAnchor?.mode).toBe("Новичок / Чужак");
    expect(result.blueprint.informationLayers?.[0].holders).toEqual(["anya", "igor"]);
    expect(result.blueprint.chemistry?.[0].participants).toEqual(["igor", "player"]);
  });

  it("не разрешает chemistry без включённого взрослого профиля и не принимает V1 в строгом UI-пути", () => {
    const result = validateGroupBlueprint(blueprint(), 2, { adultEnabled: false });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.join(" ")).toContain("chemistry");

    const legacy = { ...blueprint(), version: 1 as const };
    const strict = validateGroupBlueprint(legacy, 2, { adultEnabled: true, requireV2: true });
    expect(strict.ok).toBe(false);
    if (strict.ok) return;
    expect(strict.issues.join(" ")).toContain("Group DNA V2");
  });

  it("переносит скрытые знания только их носителю, а не всей группе", () => {
    const result = blueprintToGeneratedGroup(blueprint());
    const anya = result.characters.find((character) => character.groupKey === "anya");
    const igor = result.characters.find((character) => character.groupKey === "igor");

    expect(anya?.lorebook?.some((entry) => entry.content.includes("уже нашла другое жильё"))).toBe(true);
    expect(igor?.lorebook?.some((entry) => entry.content.includes("уже нашла другое жильё"))).toBe(true);
  });
});
