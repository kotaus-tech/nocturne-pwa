import { describe, expect, it } from "vitest";
import {
  DEFAULT_STUDIO_SETTINGS,
  buildRefineRequest,
  cleanPromptText,
  composeImagePrompt,
  composeShortPrompt,
  type ComposeInput,
} from "../src/services/promptStudio";

const baseInput: ComposeInput = {
  characterName: "Ая",
  appearance:
    "Молодая женщина с короткими чёрными волосами. Спокойная, наблюдательная, говорит мало.",
  scene:
    "*Она обернулась через плечо.* — Ты всё-таки пришёл, — тихо сказала Ая, не отводя взгляда.",
  settings: { ...DEFAULT_STUDIO_SETTINGS, extras: ["rain", "neon"] },
};

const compose = (patch: Partial<ComposeInput> = {}) =>
  composeImagePrompt({ ...baseInput, ...patch });

describe("cleanPromptText", () => {
  it("убирает ролевую разметку и лишние пробелы", () => {
    expect(cleanPromptText("  **жирный**   текст  ")).toBe("жирный текст");
    expect(cleanPromptText("<thought>шёпот</thought> реплика")).toBe("шёпот реплика");
    expect(cleanPromptText("```meta\n{}\n```")).toBe("");
  });
});

describe("composeImagePrompt", () => {
  it("начинается с типа кадра и имени", () => {
    expect(compose().startsWith("close-up portrait of Ая,")).toBe(true);
    expect(compose({ settings: { ...baseInput.settings, frame: "scene" } })).toContain(
      "cinematic scene featuring Ая"
    );
  });

  it("включает внешность персонажа и контекст сцены без разметки", () => {
    const prompt = compose();

    expect(prompt).toContain("короткими чёрными волосами");
    expect(prompt).toContain("Она обернулась через плечо");
    expect(prompt).not.toContain("*");
  });

  it("собирает выбранные стиль, оптику, свет и настроение", () => {
    const prompt = compose();

    expect(prompt).toContain("photorealistic photography");
    expect(prompt).toContain("85mm lens");
    expect(prompt).toContain("golden hour");
    expect(prompt).toContain("warm welcoming mood");
  });

  it("добавляет детали обстановки и негативный промпт", () => {
    const prompt = compose();

    expect(prompt).toContain("light rain");
    expect(prompt).toContain("neon");
    expect(prompt).toContain("\n\nNEGATIVE: ");
  });

  it("не добавляет негатив, если он выключен", () => {
    const prompt = compose({ settings: { ...baseInput.settings, includeNegative: false } });
    expect(prompt).not.toContain("NEGATIVE");
  });

  it("не оставляет двойных запятых и висящих запятых", () => {
    const prompt = compose();
    expect(prompt).not.toMatch(/,\s*,/);
    expect(prompt.split("\n")[0].trimEnd().endsWith(",")).toBe(false);
  });

  it("переживает пустые внешность и сцену", () => {
    const prompt = compose({ appearance: "", scene: "" });

    expect(prompt).not.toContain("scene:");
    expect(prompt.startsWith("close-up portrait of Ая,")).toBe(true);
  });

  it("подставляет имя по умолчанию, если персонаж безымянный", () => {
    expect(compose({ characterName: "" })).toContain("the character");
  });

  it("учитывает свой текст и пропорции кадра", () => {
    const prompt = compose({
      notes: "старый шрам на брови",
      settings: { ...baseInput.settings, aspect: "16:9" },
    });

    expect(prompt).toContain("старый шрам на брови");
    expect(prompt).toContain("aspect ratio 16:9");
  });
});

describe("composeShortPrompt", () => {
  it("короче полного промпта и без служебных усилителей", () => {
    const full = compose();
    const short = composeShortPrompt(baseInput);

    expect(short.length).toBeLessThan(full.length);
    expect(short).toContain("close-up portrait of Ая");
    expect(short).not.toContain("ultra detailed");
  });
});

describe("buildRefineRequest", () => {
  it("перечисляет выбранные настройки для модели-редактора", () => {
    const request = buildRefineRequest(baseInput);

    expect(request).toContain("Character: Ая");
    expect(request).toContain("Appearance:");
    expect(request).toContain("Scene context:");
    expect(request).toContain("style: Фото");
    expect(request).toContain("extras:");
  });
});
