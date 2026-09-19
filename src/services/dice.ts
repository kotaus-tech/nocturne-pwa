export type FateOutcome = "triumph" | "success" | "twist" | "fail";

export interface FateResult {
  outcome: FateOutcome;
  label: string;
  subtext: string;
  tag: string;
}

/** 
 * Проверка удачи (Fate Check) с 4 кинематографичными исходами:
 * - 🌟 Триумф (~15%)
 * - 🟢 Успех (~45%)
 * - 🟡 С нюансом / подвохом (~25%)
 * - 🔴 Провал (~15%)
 */
export function rollFate(): FateResult {
  const rand = Math.random() * 100;

  if (rand < 15) {
    return {
      outcome: "triumph",
      label: "Критический триумф",
      subtext: "Идеальное попадание, яркий восторг",
      tag: `[🎲 Проверка судьбы: Триумф (Действие удалось великолепно, вызови восхищение или яркую взаимность!)]`,
    };
  }

  if (rand < 60) {
    return {
      outcome: "success",
      label: "Чистый успех",
      subtext: "Всё прошло гладко и уверенно",
      tag: `[🎲 Проверка судьбы: Успех (Действие удалось без помех)]`,
    };
  }

  if (rand < 85) {
    return {
      outcome: "twist",
      label: "Успех с нюансом",
      subtext: "Удалось, но возникла неловкость или подвох",
      tag: `[🎲 Проверка судьбы: С нюансом (Задуманное удалось, НО возникла неловкая деталь, заминка, смущение или лёгкий подвох)]`,
    };
  }

  return {
    outcome: "fail",
    label: "Неудача",
    subtext: "Пошло не по плану, помеха",
    tag: `[🎲 Проверка судьбы: Провал (Действие сорвалось или вызвало насмешку/помеху)]`,
  };
}

// Хелпер для парсинга тега судьбы из сообщения
export function parseFateTag(text: string): { outcome: FateOutcome; label: string; cleanText: string } | null {
  const match = text.match(/\[🎲 Проверка судьбы:\s*([^(]+?)\s*\([^)]+?\)]/i);
  if (!match) return null;

  const rawLabel = match[1].trim().toLowerCase();
  let outcome: FateOutcome = "success";
  let label = "Успех";

  if (rawLabel.includes("триумф")) {
    outcome = "triumph";
    label = "Триумф";
  } else if (rawLabel.includes("нюанс")) {
    outcome = "twist";
    label = "С нюансом";
  } else if (rawLabel.includes("провал")) {
    outcome = "fail";
    label = "Неудача";
  } else {
    outcome = "success";
    label = "Успех";
  }

  const cleanText = text.replace(match[0], "").trim();
  return { outcome, label, cleanText };
}