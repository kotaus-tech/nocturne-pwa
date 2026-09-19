import { describe, expect, it } from "vitest";
import { safeParseJson } from "../src/services/memoryEngine";
import { extractJsonBlock } from "../src/services/jsonRepair";

describe("разбор ответа памяти", () => {
  it("читает обычный JSON и markdown-обёртку", () => {
    expect(safeParseJson('{"mood":"спокойствие"}').mood).toBe("спокойствие");
    expect(safeParseJson('```json\n{"mood":"тревога"}\n```').mood).toBe("тревога");
  });

  it("дорезает оборванный ответ по вложенности, а не по счёту скобок", () => {
    // Модель оборвалась в середине вложенного массива фактов.
    const raw =
      '{\n  "diaryThought": "Он снова рядом",\n  "mood": "тепло",\n' +
      '  "activeFacts": [\n    { "keys": ["прогулка"], "content": "Мы гуляли у реки" },\n' +
      '    { "keys": ["дождь"], "content": "Начался дождь" }\n  ],\n' +
      '  "summary": "Он вернулся"';

    const parsed = safeParseJson(raw);

    expect(parsed.diaryThought).toBe("Он снова рядом");
    expect(parsed.summary).toBe("Он вернулся");
    expect(parsed.activeFacts).toHaveLength(2);
    expect(parsed.activeFacts[1].content).toBe("Начался дождь");
  });

  it("закрывает оборванную строку и вложенные объекты", () => {
    const parsed = safeParseJson('{"summary":"Он сказал: «я вернулся»');

    expect(parsed.summary).toContain("я вернулся");
  });

  it("терпит неэкранированные переносы строк внутри значений", () => {
    const parsed = safeParseJson('{"diaryThought":"Первая строка\nВторая строка"}');

    expect(parsed.diaryThought).toBe("Первая строка\nВторая строка");
  });

  it("спасает поля, когда JSON развалился совсем", () => {
    const parsed = safeParseJson(
      'Вот результат: "diaryThought": "Он ушёл молча", "mood": "грусть", "summary": "Ссора у двери"'
    );

    expect(parsed.diaryThought).toBe("Он ушёл молча");
    expect(parsed.mood).toBe("грусть");
    expect(parsed.summary).toBe("Ссора у двери");
  });

  it("снимает reasoning-обёртки перед разбором", () => {
    const parsed = safeParseJson('</think>{"mood":"радость"}');

    expect(parsed.mood).toBe("радость");
  });

  it("падает понятно, когда JSON нет вовсе", () => {
    expect(() => safeParseJson("Просто проза без структуры")).toThrow();
  });
});

describe("extractJsonBlock", () => {
  it("берёт первый объект и закрывает его по вложенности", () => {
    expect(extractJsonBlock('мусор {"a":[1,2]} хвост')).toEqual({
      block: '{"a":[1,2]}',
      closers: "",
    });
  });

  it("не путает скобки внутри строк", () => {
    expect(extractJsonBlock('{"text":"скобки { и [ внутри строки"}')).toEqual({
      block: '{"text":"скобки { и [ внутри строки"}',
      closers: "",
    });
  });

  it("подсказывает, что дописать оборванному ответу", () => {
    const result = extractJsonBlock('{"list":[{"a":1},{"b":"обрыв');

    expect(result?.block).toBe('{"list":[{"a":1},{"b":"обрыв');
    expect(result?.closers).toBe('"}]}');
  });

  it("возвращает null, если скобок нет", () => {
    expect(extractJsonBlock("обычный текст")).toBeNull();
  });
});
