import { describe, expect, it } from "vitest";
import {
  parseLeftScene,
  parseMetaBlock,
  parseReturnedNames,
} from "../src/services/metaParser";
import { DEFAULT_STATS } from "../src/types";
import type { RelationshipStats } from "../src/types";

/**
 * Шкалы, с которыми сравниваем результат. Ответ модели обязан менять только те
 * значения, которые она реально указала.
 */
const base: RelationshipStats = { ...DEFAULT_STATS, trust: 50, affection: 30 };

const withBase = (raw: string) => parseMetaBlock(raw, base);

describe("parseMetaBlock: облачный мета-протокол", () => {
  it("разбирает корректный блок meta и убирает его из текста", () => {
    const result = withBase(
      'Она улыбнулась.\n\n```meta\n{"innerThought":"Он вернулся","feelingHint":"Тепло","stats":{"trust":55,"affection":31}}\n```'
    );

    expect(result.text).toBe("Она улыбнулась.");
    expect(result.innerThought).toBe("Он вернулся");
    expect(result.feelingHint).toBe("Тепло");
    expect(result.stats?.trust).toBe(55);
    expect(result.stats?.affection).toBe(31);
    expect(result.stats?.statusTitle).toBe(base.statusTitle);
    expect(result.metaWarning).toBeUndefined();
  });

  it("не трогает посторонний код-блок, стоящий перед мета-блоком", () => {
    const result = withBase(
      'Смотри:\n```js\nconsole.log(1);\n```\nВот ответ.\n\n```meta\n{"innerThought":"Тихо","stats":{"trust":61}}\n```'
    );

    expect(result.text).toContain("console.log(1);");
    expect(result.text).not.toContain("```meta");
    expect(result.text).not.toContain("innerThought");
    expect(result.stats?.trust).toBe(61);
  });

  it("оставляет в тексте ```json с посторонним содержимым", () => {
    const result = withBase('Настройки:\n```json\n{"theme":"dark","volume":3}\n```\nГотово.');

    expect(result.text).toContain('"theme"');
    expect(result.stats).toBeUndefined();
  });

  it("оставляет в тексте посторонний код, если меты нет вовсе", () => {
    const result = withBase('Фрагмент:\n```python\nprint("hi")\n```\nКонец.');

    expect(result.text).toContain('print("hi")');
    expect(result.stats).toBeUndefined();
  });

  it("разбирает JSON без ограждения в конце ответа", () => {
    const result = withBase(
      'Реплика героя.\n{"innerThought":"Насторожен","feelingHint":"Тревога","stats":{"tension":40}}'
    );

    expect(result.text).toBe("Реплика героя.");
    expect(result.innerThought).toBe("Насторожен");
    expect(result.stats?.tension).toBe(40);
  });

  it("из двух мета-блоков берёт последний и убирает оба", () => {
    const result = withBase(
      'Реплика.\n```meta\n{"stats":{"trust":10}}\n```\nЕщё строка.\n```meta\n{"stats":{"trust":90}}\n```'
    );

    expect(result.stats?.trust).toBe(90);
    expect(result.text).toContain("Реплика.");
    expect(result.text).toContain("Ещё строка.");
    expect(result.text).not.toContain("meta");
  });

  it("понимает блок без языка и с языком json", () => {
    const fenceless = withBase(
      'Реплика.\n```\n{"feelingHint":"Спокойствие","stats":{"trust":49}}\n```'
    );

    expect(fenceless.text).toBe("Реплика.");
    expect(fenceless.feelingHint).toBe("Спокойствие");
    expect(fenceless.stats?.trust).toBe(49);
  });

  it("лечит висячие запятые и «умные» кавычки", () => {
    const result = withBase(
      'Реплика.\n```meta\n{"innerThought":\u201cЛадно\u201d,"stats":{"trust":70,},}\n```'
    );

    expect(result.stats?.trust).toBe(70);
    expect(result.innerThought).toBe("Ладно");
    expect(result.metaWarning).toBeUndefined();
  });

  it("обрезанный стрим убирает из текста, но шкалы не меняет молча", () => {
    const result = withBase('Реплика героя.\n```meta\n{"innerThought":"Обрыв');

    expect(result.text).toBe("Реплика героя.");
    expect(result.stats).toBeUndefined();
    expect(typeof result.metaWarning).toBe("string");
  });

  it("о битом блоке meta сообщает и не показывает JSON в реплике", () => {
    const result = withBase('Реплика.\n```meta\n{"innerThought": "без закрывающей кавычки, }\n```');

    expect(result.text).toBe("Реплика.");
    expect(result.stats).toBeUndefined();
    expect(result.metaWarning).toBeTruthy();
  });
});

describe("parseMetaBlock: возвращение персонажей в сцену", () => {
  it("читает список вернувшихся из мета-блока и убирает блок из текста", () => {
    const result = withBase(
      '*Дверь хлопнула.*\n\n```meta\n{"returned":["Мира","Кай"],"feelingHint":"Тепло"}\n```'
    );

    expect(result.text).toBe("*Дверь хлопнула.*");
    expect(result.returnedNames).toEqual(["Мира", "Кай"]);
    expect(result.feelingHint).toBe("Тепло");
  });

  it("принимает одиночное имя строкой и русское имя поля", () => {
    expect(withBase('```meta\n{"returned":"Мира"}\n```').returnedNames).toEqual([
      "Мира",
    ]);
    expect(withBase('```meta\n{"вернулся":"Кай"}\n```').returnedNames).toEqual([
      "Кай",
    ]);
  });

  it("понимает перечисление в одной строке, точки с запятой и лишние пробелы", () => {
    expect(parseReturnedNames(" Мира , Кай;  ")).toEqual(["Мира", "Кай"]);
    expect(parseReturnedNames(["Мира"])).toEqual(["Мира"]);
    expect(parseReturnedNames([{ name: "Кай" }])).toEqual(["Кай"]);
    expect(parseReturnedNames(undefined)).toEqual([]);
    expect(parseReturnedNames([42, null, ""])).toEqual([]);
  });

  it("поддерживает локальный тег returned", () => {
    const result = parseMetaBlock('<returned names="Мира" />\n— Я вернулась.');

    expect(result.returnedNames).toEqual(["Мира"]);
    expect(result.text).not.toContain("<returned");
  });

  it("без поля returned ничего не выдумывает", () => {
    expect(withBase('```meta\n{"feelingHint":"Тепло"}\n```').returnedNames).toBeUndefined();
  });
});

describe("parseMetaBlock: уход героя за кадр", () => {
  it("читает словарь «кто и почему ушёл» из мета-блока", () => {
    const result = withBase(
      '*Рин хватает куртку.*\n\n```meta\n{"left":{"Рин":"ушла за сигаретами"}}\n```'
    );

    expect(result.text).toBe("*Рин хватает куртку.*");
    expect(result.left).toEqual([{ name: "Рин", reason: "ушла за сигаретами" }]);
  });

  it("принимает список имён и отдельные причины", () => {
    expect(parseLeftScene(["Ая", "Кай"])).toEqual([
      { name: "Ая" },
      { name: "Кай" },
    ]);
    expect(parseLeftScene([{ name: "Ая", reason: "ушла в душ" }])).toEqual([
      { name: "Ая", reason: "ушла в душ" },
    ]);
    expect(parseLeftScene("Ая, Кай")).toEqual([{ name: "Ая" }, { name: "Кай" }]);
    expect(parseLeftScene(undefined)).toEqual([]);
    expect(parseLeftScene([42])).toEqual([]);
  });

  it("поддерживает локальный тег left с причиной", () => {
    const result = parseMetaBlock(
      '<left names="Рин" reason="ушла в магазин" />\n— Я быстро.'
    );

    expect(result.left).toEqual([{ name: "Рин", reason: "ушла в магазин" }]);
    expect(result.text).not.toContain("<left");
  });

  it("без поля left ничего не выдумывает", () => {
    expect(withBase('```meta\n{"feelingHint":"Тепло"}\n```').left).toBeUndefined();
  });
});

describe("parseMetaBlock: шкалы", () => {
  it("понимает числа строкой и дельты", () => {
    const absolute = withBase('Текст.\n```meta\n{"stats":{"trust":"70","affection":"20"}}\n```');
    expect(absolute.stats?.trust).toBe(70);
    expect(absolute.stats?.affection).toBe(20);

    const relative = withBase('Текст.\n```meta\n{"stats":{"trust":"+7","affection":"-4"}}\n```');
    expect(relative.stats?.trust).toBe(57);
    expect(relative.stats?.affection).toBe(26);
  });

  it("не выходит за границы 0..100", () => {
    const result = withBase('Текст.\n```meta\n{"stats":{"trust":150,"conflict":-20}}\n```');

    expect(result.stats?.trust).toBe(100);
    expect(result.stats?.conflict).toBe(0);
  });

  it("не сбрасывает шкалы, которых нет в блоке", () => {
    const result = withBase('Текст.\n```meta\n{"stats":{"trust":80}}\n```');

    expect(result.stats?.trust).toBe(80);
    expect(result.stats?.affection).toBe(base.affection);
    expect(result.stats?.closeness).toBe(base.closeness);
  });
});

describe("parseMetaBlock: локальный протокол тегов", () => {
  it("читает <thought> и <stats> с дельтами", () => {
    const result = withBase('<thought>Надо быть мягче</thought>\nОна кивнула.\n<stats trust="+5" hint="Тепло"/>');

    expect(result.text).toBe("Она кивнула.");
    expect(result.innerThought).toBe("Надо быть мягче");
    expect(result.stats?.trust).toBe(55);
    expect(result.feelingHint).toBe("Тепло");
  });

  it("считает отрицательные дельты от текущих значений", () => {
    const result = withBase('<stats trust="-8" affection="+2" tension="+10"/>Реплика.');

    expect(result.stats?.trust).toBe(42);
    expect(result.stats?.affection).toBe(32);
    expect(result.stats?.tension).toBe(20);
  });

  it("вырезает рассуждения reasoning-моделей", () => {
    const result = withBase("<think>долгие раздумья</think>\nРеплика.");

    expect(result.text).toBe("Реплика.");
    expect(result.innerThought).toBeUndefined();
  });

  it("облачные метаданные перекрывают теги", () => {
    const result = withBase(
      '<stats trust="+5"/><thought>Из тега</thought>\nРеплика.\n```meta\n{"innerThought":"Из JSON","stats":{"trust":99}}\n```'
    );

    expect(result.innerThought).toBe("Из JSON");
    expect(result.stats?.trust).toBe(99);
    expect(result.text).toBe("Реплика.");
  });
});

describe("parseMetaBlock: обычный текст", () => {
  it("не меняет ответ без метаданных", () => {
    const result = withBase("Просто реплика без метаданных.");

    expect(result.text).toBe("Просто реплика без метаданных.");
    expect(result.stats).toBeUndefined();
    expect(result.innerThought).toBeUndefined();
  });

  it("на пустой строке возвращает пустой результат", () => {
    expect(parseMetaBlock("")).toEqual({ text: "" });
  });
});
