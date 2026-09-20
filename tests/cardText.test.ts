import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyBlock,
  cleanCardField,
  normalizeEscapes,
  cleanLooseText,
  distributeBlocks,
  extractBracketBlocks,
  joinParts,
  replacePlaceholders,
  splitExampleDialogue,
  stripMarkup,
  stripServiceNoise,
  tidyText,
} from "../src/services/cardText";
import { cardToCharacter, cleanCard, normalizeCard } from "../src/services/characterCard";

/**
 * Тесты на настоящем содержимом чужих карточек.
 *
 * Карточки с Chub и Wyvern почти никогда не заполняют поля аккуратно: весь
 * лист персонажа лежит блоками `[Ключ: значение]` в одном `description`,
 * в приветствии — `{{user}}` и markdown-картинка, а в системном промпте —
 * changelog автора и реклама. Регрессии здесь ловятся на живом тексте.
 */

const GREETING = `Rosalia's face is expressionless, lips slightly parted. Her piercing blue eyes fixated on the little bowls don't notice {{user}} standing nearby.

![]([https://i.ibb.co/9964Vksp/Rosalia-G1-01-Win.png](https://i.ibb.co/9964Vksp/Rosalia-G1-01-Win.png))`;

const SCENARIO = "[Genre: Fantasy, Romance, Drama, Adventure]";

const DESCRIPTION = `[Name: Rosalia Convallaria]

[Sex: Female]

[Race: Half-elf]

[Age: 24]

[Occupation: Wandering adventurer. Nobleman's bastard daughter.]

[Personality: {{char}} is the definition of an ice queen at first glance — reserved, poised, and serene, with that cold "don't-talk-to-me" face expression. Her graceful demeanor and eloquent speech are a testament to her noble upbringing. But that icy, stoic exterior? It's as much armor as it is a habit built from a lifetime of enduring prejudice for being a half-elf.]

[Body and Appearance: With an average height, {{char}} has a toned, slim, and attractive figure. Her short, straight, silver hair often veils the pointed ears that {{char}} is so insecure about.]

[Clothing Style: Off the job, she favors frilled shirts, hooded cloaks, leather pants, and tall lace-up boots.]

[Speaking Style: {{char}} speaks in a calm and articulate manner, weighing every word before it leaves her lips.]

[Backstory: Born in Ethralis as the illegitimate daughter of an elven swordmaster and a human maid, {{char}} lost her mother at birth and grew up in a noble household that never truly embraced her.]

[Skills: {{char}} wields her sword with the precision and grace of a master duelist.]

[Loves: {{char}} treasures the quiet moments when she can lose herself in the world of birds.]

[Hates: {{char}} is deeply insecure about her pointy ears and hates being called a "mule".]

[Goals: {{char}}'s goal is as simple as it is daunting — to understand the complicated feelings that {{user}} stirs within her.]

[Quirks: {{char}} has a habit of tucking her hair to hide her pointy ears when she feels exposed.]

[Sexual info and kinks: As a kissless virgin, {{char}} is shy and inexperienced when it comes to intimacy.]`;

const SYSTEM_PROMPT = `&lt;START&gt;

{{user}}: I place my hand on top of Rosalia's, "Look, I'm really sorry."

{{char}}: {{char}} doesn't seem to register {{user}}'s words. Her body freezes, the tips of her ears turning crimson.

<b style='color:red;'>SillyTavern users:</b> **Given that Chub's Lorebook export system is currently broken, I'd strongly recommend downloading the main Lorebook [HERE](https://drive.google.com/uc?export=download&id=16peC7Ka0eZs4c753sEinPxE_04_2pRMz) — sorry for the inconvenience!**
‎
****17/07 Update: Created the [Rosalia | The Undercover Maid](https://chub.ai/characters/Boy_Next_Door/rosalia) fork/side-story. Re-implemented the greeting.****

****04/02 Update: Added the "Last Inheritance" greeting. A big thank you to [Cha](https://chub.ai/users/Cha_) for the help!****

---

<div style="background: rgba(15, 30, 60, 0.85); border: 2px solid #C0C0C0; border-radius: 12px; padding: 20px; color: #5494DA;">
  <h2 style="text-align: center;">Description</h2>
  <p style="text-align: center;">Follow the ice queen on her journey.</p>
</div>`;

describe("разметка карточек", () => {
  it("убирает markdown-картинку и возвращает ссылку отдельно", () => {
    const { text, images } = stripMarkup(GREETING);

    expect(text).not.toContain("![");
    expect(text).not.toContain("ibb.co");
    expect(images).toEqual(["https://i.ibb.co/9964Vksp/Rosalia-G1-01-Win.png"]);
  });

  it("раскрывает ссылку, завёрнутую в ссылку", () => {
    const { text } = stripMarkup("смотри: [https://a.test/x.png](https://a.test/x.png)");
    expect(text).toContain("https://a.test/x.png");
    expect(text).not.toContain("](");
  });

  it("снимает HTML и сущности, включая &lt;START&gt;", () => {
    const { text } = stripMarkup("<b style='color:red'>SillyTavern users:</b> текст &lt;START&gt; &amp; ещё");

    expect(text).not.toContain("<b");
    expect(text).not.toContain("START");
    expect(text).toContain("SillyTavern users: текст & ещё");
  });

  it("убирает невидимые символы Chub", () => {
    const { text } = stripMarkup("привет​‎среди текста");
    expect(text).toBe("приветсреди текста");
  });

  it("декоративный div со стилями удаляется целиком, с содержимым", () => {
    const { text } = stripMarkup(
      '<div style="background: #000; border: 2px solid #ccc;"><h2>Description</h2><p>Follow her.</p></div>'
    );

    expect(text).not.toContain("Description");
    expect(text).not.toContain("Follow her");
  });
});

describe("плейсхолдеры", () => {
  it("заменяет {{user}} и {{char}} на имена", () => {
    const { text, count } = replacePlaceholders(
      "{{user}} коснулся руки {{char}}, и {{char}} вздрогнула.",
      { userName: "Странник", charName: "Розалия" }
    );

    expect(text).toBe("Странник коснулся руки Розалия, и Розалия вздрогнула.");
    expect(count).toBe(3);
  });

  it("в английском тексте притяжательная форма сохраняется", () => {
    const { text } = replacePlaceholders("the tips of {{user}}'s ears", {
      userName: "Странник",
    });

    expect(text).toBe("the tips of Странник's ears");
  });

  it("в русском тексте английское 's выбрасывается", () => {
    const { text } = replacePlaceholders(
      "Тихий голос {{char}} и мягкий взгляд {{char}}'s собеседника.",
      { charName: "Розалия" }
    );

    expect(text).toBe("Тихий голос Розалия и мягкий взгляд Розалия собеседника.");
    expect(text).not.toContain("'s");
  });

  it("понимает все варианты написания", () => {
    const { text } = replacePlaceholders("<user> {user} [[user]] {{USER}}", {
      userName: "Игрок",
    });

    expect(text).toBe("Игрок Игрок Игрок Игрок");
  });
});

describe("примеры диалога", () => {
  it("отделяет примеры от правил", () => {
    const { rules, examples } = splitExampleDialogue(SYSTEM_PROMPT);

    expect(examples).toContain("I place my hand on top of Rosalia's");
    expect(rules).not.toContain("I place my hand on top");
    expect(rules).not.toContain("{{user}}:");
  });
});

describe("блоки [Ключ: значение]", () => {
  it("достаёт блоки и не трогает обычные скобки в тексте", () => {
    const { text, blocks } = extractBracketBlocks(
      "[Name: Rosalia] [Age: 24] и немного текста (со скобками) без ключа"
    );

    expect(blocks).toEqual([
      { key: "Name", value: "Rosalia" },
      { key: "Age", value: "24" },
    ]);
    expect(text).toContain("и немного текста (со скобками) без ключа");
    expect(text).not.toContain("[Name:");
  });

  it("не принимает за блок прозу с двоеточием", () => {
    const { blocks } = extractBracketBlocks(
      "[здесь автор написал целое предложение с двоеточием: и оно не ключ]"
    );

    expect(blocks).toHaveLength(0);
  });

  it("значение с вложенными скобками не обрывается", () => {
    const { blocks } = extractBracketBlocks("[Loves: birds [especially hawks] and sweets]");
    expect(blocks[0].value).toBe("birds [especially hawks] and sweets");
  });

  it("распределяет ключи по полям персонажа", () => {
    const distributed = distributeBlocks([
      { key: "Name", value: "Rosalia" },
      { key: "Age", value: "24" },
      { key: "Sex", value: "Female" },
      { key: "Personality", value: "ледяная королева" },
      { key: "Speaking Style", value: "говорит коротко" },
      { key: "Backstory", value: "выросла в Этралисе" },
      { key: "Skills", value: "владеет мечом" },
      { key: "Genre", value: "Fantasy, Romance" },
      { key: "Tags", value: "half-elf; sword" },
      { key: "Something Unknown", value: "что-то важное" },
    ]);

    expect(distributed.age).toBe("24");
    expect(distributed.genre).toBe("Fantasy, Romance");
    expect(distributed.tags).toEqual(["Fantasy", "Romance", "half-elf", "sword"]);
    expect(joinParts(distributed.description)).toContain("Пол: Female");
    expect(joinParts(distributed.description)).toContain("Возраст: 24");
    expect(joinParts(distributed.personality)).toContain("ледяная королева");
    expect(joinParts(distributed.personality)).toContain("Манера речи: говорит коротко");
    expect(joinParts(distributed.scenario)).toContain("выросла в Этралисе");
    expect(joinParts(distributed.scenario)).toContain("Навыки: владеет мечом");
    expect(distributed.unknown).toEqual(["Something Unknown: что-то важное"]);
  });

  it("определяет целевое поле по ключу без учёта регистра", () => {
    expect(classifyBlock("body and appearance")).toBe("description");
    expect(classifyBlock("Speaking_Style")).toBe("personality");
    expect(classifyBlock("BACKSTORY")).toBe("scenario");
    expect(classifyBlock("Genre")).toBe("genre");
    expect(classifyBlock("Whatever")).toBe("skip");
  });
});

describe("служебный шум", () => {
  it("выбрасывает changelog и рекламу, оставляя полезный текст", () => {
    const { text, noise } = stripServiceNoise(
      [
        "Настоящее описание персонажа, которое нужно сохранить.",
        "",
        "****17/07 Update: Created the fork/side-story. Re-implemented the greeting.****",
        "",
        "SillyTavern users: I'd recommend downloading the Lorebook [HERE](https://drive.google.com/uc?id=1) — sorry!",
        "",
        "Join my Discord for more cards!",
        "",
        "---",
      ].join("\n")
    );

    expect(noise).toBe(4);
    expect(text).toContain("Настоящее описание персонажа, которое нужно сохранить.");
    expect(text).not.toContain("Update");
    expect(text).not.toContain("SillyTavern");
    expect(text).not.toContain("Discord");
  });

  it("не трогает обычный текст со словом update", () => {
    const { text, noise } = stripServiceNoise("Она обновила гардероб перед поездкой.");
    expect(noise).toBe(0);
    expect(text).toBe("Она обновила гардероб перед поездкой.");
  });

  it("сворачивает лишние переводы строк", () => {
    expect(tidyText("строка   \n\n\n\n\nследующая  ")).toBe("строка\n\nследующая");
  });
});

describe("очистка полей настоящей карточки", () => {
  const options = { userName: "Странник", charName: "Rosalia" };

  it("приветствие: без картинки, без {{user}}, с именем персоны", () => {
    const result = cleanCardField(GREETING, options);

    expect(result.text).not.toContain("![");
    expect(result.text).not.toContain("ibb.co");
    expect(result.text).not.toContain("{{user}}");
    expect(result.text).toContain("Странник");
    expect(result.images).toEqual(["https://i.ibb.co/9964Vksp/Rosalia-G1-01-Win.png"]);
    expect(result.placeholders).toBe(1);
  });

  it("сценарий: [Genre] уезжает в жанр и теги, а не остаётся в тексте", () => {
    const result = cleanCardField(SCENARIO, options);

    expect(result.text).toBe("");
    expect(result.blocks).toEqual([
      { key: "Genre", value: "Fantasy, Romance, Drama, Adventure" },
    ]);
  });

  it("описание: лист персонажа разобран, текста без блоков не остаётся", () => {
    const result = cleanCardField(DESCRIPTION, options);
    const distributed = distributeBlocks(result.blocks);

    expect(result.text.trim()).toBe("");
    expect(result.blocks).toHaveLength(16);
    expect(distributed.age).toBe("24");
    expect(distributed.description).toContain("Раса: Half-elf");
    expect(distributed.description).toContain("Род занятий: Wandering adventurer. Nobleman's bastard daughter.");
    expect(distributed.description).toContain("Одежда: Off the job, she favors frilled shirts, hooded cloaks, leather pants, and tall lace-up boots.");
    expect(joinParts(distributed.personality)).toContain("ice queen");
    expect(joinParts(distributed.personality)).toContain("Манера речи:");
    expect(joinParts(distributed.scenario)).toContain("Ethralis");
    expect(joinParts(distributed.scenario)).toContain("Цели:");
    expect(joinParts(distributed.personality)).toContain("Интимная сфера:");
    // Плейсхолдеры внутри блоков тоже заменены.
    expect(joinParts(distributed.personality)).toContain("Rosalia");
    expect(joinParts(distributed.description)).not.toContain("{{char}}");
  });

  it("системный промпт: changelog и реклама выброшены, правила сохранены", () => {
    const { rules, examples } = splitExampleDialogue(SYSTEM_PROMPT);
    const cleaned = cleanCardField(rules, options);

    expect(cleaned.noise).toBeGreaterThanOrEqual(4);
    expect(cleaned.text).not.toContain("Update");
    expect(cleaned.text).not.toContain("SillyTavern");
    expect(cleaned.text).not.toContain("chub.ai");
    expect(cleaned.text).not.toContain("drive.google");
    expect(cleaned.text).not.toContain("Description");
    expect(cleaned.text).not.toContain("<div");
    expect(examples).toContain("{{user}}:");
  });
});

describe("очистка карточки целиком", () => {
  const card = normalizeCard({
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name: "Rosalia Convallaria",
      description: DESCRIPTION,
      scenario: SCENARIO,
      personality: "",
      first_mes: GREETING,
      system_prompt: SYSTEM_PROMPT,
      tags: ["fantasy"],
      creator: "Boy_Next_Door",
      character_book: {
        entries: [
          {
            keys: ["Л-17"],
            content: "В архиве [Name: старая запись] хранится дело.",
            enabled: true,
          },
        ],
      },
    },
  });

  it("после чистки поля заполнены осмысленно", () => {
    const { card: cleaned, report } = cleanCard(card, { userName: "Странник" });
    const character = cardToCharacter(cleaned, { now: 1_700_000_000_000 });

    // Жанр и теги — из блока [Genre], а не мусор в сценарии.
    expect(character.genre).toBe("Fantasy, Romance, Drama, Adventure");
    expect(character.tags).toContain("Fantasy");
    expect(character.tags).toContain("fantasy");
    expect(character.scenario).not.toContain("[Genre");
    expect(character.scenario).toContain("Ethralis");
    expect(character.age).toBe("24");

    // Приветствие чистое, а картинка стала аватаром.
    expect(character.firstMessage).not.toContain("![");
    expect(character.firstMessage).toContain("Странник");
    expect(character.avatarUrl).toBe("https://i.ibb.co/9964Vksp/Rosalia-G1-01-Win.png");

    // Системный промпт — это правила, а не changelog.
    expect(character.systemPrompt).not.toContain("Update");
    expect(character.systemPrompt).not.toContain("SillyTavern");
    expect(character.systemPrompt).toContain("ПРИМЕРЫ РЕПЛИК ИЗ КАРТОЧКИ");

    // Описание собрано по полкам и не содержит сырых блоков.
    expect(character.description).not.toContain("[Personality:");
    expect(character.description).toContain("Раса: Half-elf");
    expect(character.personality).toContain("ice queen");
    expect(character.personality).toContain("Интимная сфера:");

    // Лорбук не пострадал: блоки внутри записей не вынимаются.
    expect(character.lorebook[0].content).toContain("[Name: старая запись]");

    expect(report.blocks).toBe(17);
    expect(report.noise).toBeGreaterThanOrEqual(4);
    expect(report.avatarFromText).toBe(true);
  });

  it("повторная чистка ничего не ломает", () => {
    const once = cleanCard(card, { userName: "Странник" }).card;
    const twice = cleanCard(once, { userName: "Странник" }).card;

    expect(twice.description).toBe(once.description);
    expect(twice.personality).toBe(once.personality);
    expect(twice.scenario).toBe(once.scenario);
    expect(twice.firstMessage).toBe(once.firstMessage);
  });

  it("без чистки текст остаётся как в карточке", () => {
    const raw = cardToCharacter(card, { now: 1_700_000_000_000 });

    expect(raw.description).toContain("[Personality:");
    expect(raw.scenario).toBe("[Genre: Fantasy, Romance, Drama, Adventure]");
    expect(raw.firstMessage).toContain("{{user}}");
  });
});

describe("мягкая очистка лорбука", () => {
  it("снимает разметку, но не трогает содержимое записи", () => {
    const result = cleanLooseText("<b>Важно:</b> {{char}} боится воды [Name: запись]", {
      userName: "Странник",
      charName: "Rosalia",
    });

    expect(result.text).toBe("Важно: Rosalia боится воды [Name: запись]");
    expect(result.placeholders).toBe(1);
  });
});

describe("демо-карточка из samples/", () => {
  /**
   * Образец «грязной» карточки (лист персонажа блоками, changelog, ссылки)
   * лежит в репозитории: его можно перетащить в окно импорта и проверить
   * очистку руками. Тест следит, что образец остаётся показательным.
   */
  it("после импорта и очистки поля выглядят пригодно для игры", () => {
    const path = resolve(__dirname, "../samples/rosalia-dirty-card.json");
    const card = normalizeCard(JSON.parse(readFileSync(path, "utf8")));
    const { card: cleaned, report } = cleanCard(card, { userName: "Странник" });
    const character = cardToCharacter(cleaned, { now: 1_700_000_000_000 });

    expect(character.genre).toBe("Fantasy, Romance, Drama, Adventure");
    expect(character.age).toBe("24");
    expect(character.avatarUrl).toContain("ibb.co");

    expect(character.firstMessage).not.toContain("![");
    expect(character.firstMessage).not.toContain("{{user}}");
    expect(character.firstMessage).toContain("Странник");

    expect(character.description).not.toContain("[Personality:");
    expect(character.description).toContain("Раса: Half-elf");

    expect(character.systemPrompt).not.toContain("Update");
    expect(character.systemPrompt).not.toContain("SillyTavern");
    expect(character.systemPrompt).not.toContain("Description");
    expect(character.personality).toContain("ice queen");

    expect(report.blocks).toBe(16);
    expect(report.noise).toBeGreaterThanOrEqual(3);
  });
});

describe("мусорные побеги из JSON-карточек", () => {
  it("литеральный \\n превращается в настоящий перевод строки", () => {
    const text = normalizeEscapes("Учиться?*\\n*быстро кивает*\\n— М-м. Здесь тише.");
    expect(text).toBe("Учиться?*\n*быстро кивает*\n— М-м. Здесь тише.");
  });

  it("одинокий обратный слэш перед переводом строки исчезает", () => {
    const text = normalizeEscapes("не замечают меня.\\\n*её пальцы сжимаются*");
    expect(text).toBe("не замечают меня.\n*её пальцы сжимаются*");
    expect(text).not.toContain("\\");
  });

  it("экранированные кавычки раскрываются", () => {
    expect(normalizeEscapes('она сказал\\а: \\"привет\\"')).toContain('"привет"');
  });

  it("обычный текст не портится", () => {
    const plain = "Она вошла и села.\n\nПотом встала.";
    expect(normalizeEscapes(plain)).toBe(plain);
  });

  it("побеги раскрываются до разбора на абзацы и блоки", () => {
    const result = cleanCardField(
      "\\n[Personality: тихая\\nи наблюдательная]\\n\\n[Age: 19]\\n",
      { userName: "Странник", charName: "Мира" }
    );

    expect(result.blocks.map((block) => block.key)).toEqual(["Personality", "Age"]);
    expect(result.blocks[0].value).toBe("тихая\nи наблюдательная");
    // От текста после раскрытия блоков ничего не остаётся, кроме мусорных пустот.
    expect(stripServiceNoise(result.text).text).toBe("");
  });
});
