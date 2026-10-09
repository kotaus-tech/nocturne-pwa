import { describe, expect, it } from "vitest";
import { buildRoleplayTurnDirective } from "../src/services/turnDirectives";

describe("управляющие инструкции хода", () => {
  it("продолжает сцену без превращения игрока в молчащего участника", () => {
    const directive = buildRoleplayTurnDirective(
      "continue",
      "Игрок",
      "Персонаж"
    );

    expect(directive).toContain("Продолжение текущей сцены");
    expect(directive).toContain("в новом сообщении");
    expect(directive).toContain("не новая реплика или действие со стороны Игрок");
    expect(directive).not.toMatch(/молчит|молчание|выжидает/i);
    expect(directive).toContain("не добавляй за него реплики, мысли, решения или действия");
  });

  it("сохраняет отдельную семантику ручной инициативы", () => {
    const directive = buildRoleplayTurnDirective(
      "initiative",
      "Игрок",
      "Персонаж"
    );

    expect(directive).toContain("Игрок молчит или выжидает");
    expect(directive).toContain("прояви собственную инициативу");
  });

  it("не добавляет управляющую инструкцию к обычному ответу", () => {
    expect(buildRoleplayTurnDirective("normal", "Игрок", "Персонаж")).toBeNull();
  });
});
