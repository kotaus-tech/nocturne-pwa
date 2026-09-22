import type {
  GroupGender,
  GroupPreferences,
  GroupRelationIntensity,
  GroupUniqueness,
} from "./types";

export interface GroupCatalogOption {
  id: string;
  name: string;
  hint: string;
}

export interface GroupCatalogCategory {
  id: string;
  title: string;
  icon: string;
  max: number;
  note: string;
  options: GroupCatalogOption[];
  advanced?: boolean;
}

export const GROUP_AGE_BANDS: GroupCatalogOption[] = [
  { id: "adult_mixed", name: "Разный взрослый возраст", hint: "все совершеннолетние, возраста заметно различаются, но остаются правдоподобными для одной среды" },
  { id: "18_24", name: "18–24", hint: "все взрослые 18–24 лет: учёба, первая работа, самостоятельность без школьного контекста" },
  { id: "25_35", name: "25–35", hint: "все 25–35 лет: самостоятельная взрослая жизнь, работа и личные планы" },
  { id: "30_50", name: "30–50", hint: "все 30–50 лет: разный жизненный опыт, работа, обязательства и сложившиеся привычки" },
  { id: "wide_adult", name: "Широкий диапазон", hint: "совершеннолетние разных поколений, без романтизации неуместной разницы власти и возраста" },
];

export const GROUP_GENDER_OPTIONS: { value: GroupGender; label: string; hint: string }[] = [
  { value: "any", label: "Любой состав", hint: "пол и сочетание персонажей выбирает модель" },
  { value: "female", label: "Все девушки", hint: "все персонажи женского пола" },
  { value: "male", label: "Все парни", hint: "все персонажи мужского пола" },
  { value: "mixed", label: "Смешанный", hint: "в группе есть разные гендеры, без автоматической романтизации" },
];

export const GROUP_UNIQUENESS_OPTIONS: { value: GroupUniqueness; label: string; hint: string }[] = [
  { value: 0, label: "Знакомая жизнь", hint: "узнаваемые типажи, необычность только в деталях" },
  { value: 1, label: "Реалистичный", hint: "правдоподобные сочетания с одной-двумя неожиданными деталями" },
  { value: 2, label: "Необычный ансамбль", hint: "контрастные, но логичные характеры и обстоятельства" },
  { value: 3, label: "Максимально нестандартный", hint: "смелое сочетание ролей и конфликтов без потери причинности" },
];

export const GROUP_RELATION_OPTIONS: { value: GroupRelationIntensity; label: string; hint: string }[] = [
  { value: "light", label: "Лёгкие различия", hint: "у героев разные привычки и цели, конфликт не является обязательным" },
  { value: "balanced", label: "Живой баланс", hint: "есть симпатии, трения и взаимные интересы без единой драматической оси" },
  { value: "tense", label: "Повышенное напряжение", hint: "есть конкретная проблема или ставки, но без принудительной трагедии" },
];

export const GROUP_PRESETS = [
  {
    id: "preset_none",
    name: "Свои настройки",
    hint: "модель соберёт ансамбль по выбранным параметрам",
    selections: {},
  },
  {
    id: "preset_shared_place",
    name: "Общее место",
    hint: "люди регулярно пересекаются в одном месте, у каждого своя причина быть там",
    selections: { setting: ["shared_place"], ensemble: ["regulars"] },
  },
  {
    id: "preset_task",
    name: "Общая задача",
    hint: "разные люди вынуждены координироваться ради конкретного результата",
    selections: { ensemble: ["temporary_team"], conflict: ["deadline"] },
  },
  {
    id: "preset_mystery",
    name: "Тайна без готового ответа",
    hint: "у группы есть неоднозначная загадка, но никто не владеет всей истиной",
    selections: { setting: ["mystery_place"], tone: ["quiet_mystery"], conflict: ["missing_fact"] },
  },
  {
    id: "preset_everyday",
    name: "Обычный вечер",
    hint: "бытовая сцена, в которой характеры и отношения важнее масштабного сюжета",
    selections: { tone: ["warm_everyday"], conflict: ["small_friction"] },
  },
] as const;

export const GROUP_CATALOG: GroupCatalogCategory[] = [
  {
    id: "setting",
    title: "Общее место и среда",
    icon: "📍",
    max: 2,
    note: "Можно выбрать до двух смыслов. Пусто — модель выберет сама.",
    options: [
      { id: "shared_place", name: "Место, куда возвращаются", hint: "кафе, мастерская, спортзал, библиотека или другое место с постоянными посетителями" },
      { id: "workplace", name: "Рабочая среда", hint: "офис, студия, клиника, редакция или сервис, где роли и обязанности создают трения" },
      { id: "campus", name: "Учёба и кампус", hint: "все совершеннолетние; университет, курсы или совместный проект без школьного контекста" },
      { id: "mystery_place", name: "Место с вопросом", hint: "архив, закрытый объект, странная находка или событие, которое требует разобраться" },
      { id: "journey", name: "Дорога", hint: "поездка, пересадка, экспедиция или вынужденный маршрут с ограниченным временем" },
      { id: "neighborhood", name: "Один район", hint: "соседи и знакомые, чьи повседневные маршруты пересекаются" },
      { id: "fantasy_settlement", name: "Фэнтезийное поселение", hint: "город, порт, трактир или община с локальными правилами; мир строится компактно" },
      { id: "scifi_station", name: "Станция или корабль", hint: "научная фантастика: общий замкнутый объект, разные функции и интересы" },
    ],
  },
  {
    id: "ensemble",
    title: "Почему они вместе",
    icon: "👥",
    max: 2,
    note: "Связь группы — не обязательно дружба или романтика.",
    options: [
      { id: "regulars", name: "Постоянные знакомые", hint: "они регулярно видят друг друга, но знают друг друга не одинаково хорошо" },
      { id: "temporary_team", name: "Временная команда", hint: "общая задача свела людей с разными навыками и приоритетами" },
      { id: "old_circle", name: "Старый круг", hint: "часть общей истории уже существует, но у каждого своя версия прошлого" },
      { id: "strangers_together", name: "Случайные попутчики", hint: "они оказались рядом из-за обстоятельств и ещё не образуют сплочённую команду" },
      { id: "professional_network", name: "Профессиональная сеть", hint: "коллеги, заказчики, конкуренты и посредники пересеклись в одном деле" },
      { id: "unequal_knowledge", name: "Знают не одно и то же", hint: "каждый обладает своим кусочком контекста; личные знания не превращаются в общий мета-знание" },
    ],
  },
  {
    id: "tone",
    title: "Тон сцены",
    icon: "🎨",
    max: 2,
    note: "Тон задаёт атмосферу, но не отменяет автономию и бытовую правдоподобность.",
    options: [
      { id: "warm_everyday", name: "Тёплая повседневность", hint: "уют, бытовые детали и мягкий юмор без обязательной романтики" },
      { id: "quiet_mystery", name: "Тихая загадка", hint: "неясный вопрос, наблюдения и недосказанность без гарантированного ужаса" },
      { id: "quick_humor", name: "Живой юмор", hint: "разные типы юмора и неловкость, а не бесконечные шутки всех подряд" },
      { id: "focused_drama", name: "Точечная драма", hint: "одна конкретная эмоциональная проблема, не трагедия ради глубины" },
      { id: "adventure", name: "Приключение", hint: "движение, риск и решения, но последствия остаются соразмерными" },
      { id: "slow_observation", name: "Наблюдательная сцена", hint: "темп через жесты, детали места и разговоры между NPC" },
    ],
  },
  {
    id: "conflict",
    title: "Двигатель момента",
    icon: "⚡",
    max: 2,
    note: "Модель создаст конкретный повод для начала, но не закроет его в опенинге.",
    options: [
      { id: "small_friction", name: "Мелкое трение", hint: "разные привычки, спор о решении или неудобство, которое нужно разрулить" },
      { id: "deadline", name: "Срок и давление", hint: "времени мало, но задача не должна превращаться в катастрофу" },
      { id: "missing_fact", name: "Недостающий факт", hint: "важная деталь неизвестна, и герои по-разному оценивают пробел" },
      { id: "conflicting_goals", name: "Разные цели", hint: "участники хотят совместить несовпадающие результаты" },
      { id: "resource_choice", name: "Ограниченный ресурс", hint: "время, место, деньги, доступ или предмет нужно распределить" },
      { id: "unexpected_change", name: "Новая перемена", hint: "обычный план нарушен событием, не требующим немедленного апокалипсиса" },
    ],
  },
  {
    id: "relationshipStyle",
    title: "Рисунок связей",
    icon: "🧩",
    max: 2,
    advanced: true,
    note: "Связи направленные и не обязаны быть симметричными.",
    options: [
      { id: "mixed_asymmetry", name: "Смешанная асимметрия", hint: "у разных пар разные роли: уважение, долг, раздражение, интерес, осторожность" },
      { id: "rivals_allies", name: "Соперники, которые сотрудничают", hint: "конкуренция не отменяет способности помогать друг другу" },
      { id: "quiet_history", name: "Общее прошлое", hint: "часть связей держится на событиях, о которых не все знают одинаково" },
      { id: "uneven_trust", name: "Неравномерное доверие", hint: "один доверяет, другой пользуется осторожностью; не все отношения зеркальны" },
      { id: "no_romance_default", name: "Без романтической оси", hint: "любая близость остаётся дружеской, профессиональной, семейной или ситуативной, если пользователь явно не задал иное" },
    ],
  },
];

export function resolveGroupAge(id: string): string {
  return GROUP_AGE_BANDS.find((item) => item.id === id)?.hint ?? "все персонажи совершеннолетние, возраст выбери правдоподобно";
}

export function resolveGroupPreferencesBlock(prefs: GroupPreferences): string {
  const selected: string[] = [];
  for (const category of GROUP_CATALOG) {
    const ids = prefs.selections?.[category.id] ?? [];
    for (const option of category.options) {
      if (ids.includes(option.id)) selected.push(`${category.title}: ${option.name} — ${option.hint}`);
    }
  }

  const gender = GROUP_GENDER_OPTIONS.find((item) => item.value === prefs.gender)?.hint ?? "пол на усмотрение";
  const uniqueness = GROUP_UNIQUENESS_OPTIONS.find((item) => item.value === prefs.uniqueness)?.hint ?? "реалистичные сочетания";
  const relation = GROUP_RELATION_OPTIONS.find((item) => item.value === prefs.relationIntensity)?.hint ?? "живой баланс";
  const age = resolveGroupAge(prefs.ageBandId);

  return [
    `Размер: ${prefs.size} персонажа(ей).`,
    `Состав: ${gender}.`,
    `Возраст: ${age}.`,
    `Разнообразие: ${uniqueness}.`,
    `Связи: ${relation}.`,
    prefs.adultEnabled
      ? "Взрослый контекст разрешён только для совершеннолетних и только при естественной взаимности; не переводить всю сцену в секс."
      : "Взрослый профиль не запрошен: не сексуализировать обычную сцену.",
    selected.length > 0 ? `Выбранные смыслы:\n- ${selected.join("\n- ")}` : "Выбранные смыслы: нет, реши их сам и не делай ансамбль безликим.",
    typeof prefs.customIdea === "string" && prefs.customIdea.trim()
      ? `Авторская задумка пользователя имеет высокий приоритет:\n${prefs.customIdea.trim()}`
      : "Авторской задумки нет: предложи конкретное, не шаблонное начало.",
  ].join("\n");
}

export function presetSelections(presetId: string): Record<string, string[]> {
  const preset = GROUP_PRESETS.find((item) => item.id === presetId);
  return preset ? Object.fromEntries(Object.entries(preset.selections).map(([key, ids]) => [key, [...ids]])) : {};
}
