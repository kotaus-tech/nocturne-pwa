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
  /** Старые варианты остаются доступными для compatibility payload, но не показываются в V2 UI. */
  legacy?: boolean;
  /** Видимы только при включённом контекстном взрослом профиле. */
  adultOnly?: boolean;
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

/**
 * Пресеты 2.0 — бытовые социальные ситуации. Старые пресеты не удаляются:
 * сохранённые payload могут ссылаться на их id, но в интерфейсе показываются
 * только современные связки.
 */
export const GROUP_PRESETS = [
  {
    id: "preset_none",
    name: "Свои настройки",
    hint: "модель соберёт ансамбль по выбранным параметрам",
    selections: {},
  },
  {
    id: "preset_edge_neutrality",
    name: "Бытовой нейтралитет на грани",
    hint: "соседи делят территорию; мелкие претензии держатся на вежливости до первого повода",
    selections: {
      setting: ["neighborhood"],
      ensemble: ["regulars"],
      physicalConditions: ["cramped_shared_space"],
      conflict: ["uncomfortable_question"],
      playerAnchor: ["newcomer"],
    },
  },
  {
    id: "preset_night_shift",
    name: "Ночная смена / Изнанка",
    hint: "общая усталость, остывший кофе, профессиональный цинизм и спасительный чёрный юмор",
    selections: {
      setting: ["workplace"],
      ensemble: ["professional_network"],
      physicalConditions: ["night_offhours", "backstage_urban"],
      tone: ["slow_observation"],
      conflict: ["emotional_snap"],
      ensembleRoles: ["tired_pragmatist", "social_glue"],
    },
  },
  {
    id: "preset_after_party",
    name: "После тусовки (3:00 AM)",
    hint: "лишние разошлись, остались свои в полутьме и атмосфере большей искренности",
    selections: {
      setting: ["shared_place"],
      ensemble: ["old_circle"],
      physicalConditions: ["night_offhours"],
      tone: ["warm_everyday"],
      conflict: ["privacy_breach"],
      playerAnchor: ["equal_participant"],
    },
  },
  {
    id: "preset_truce",
    name: "Вынужденное перемирие",
    hint: "люди с давним конфликтом вынуждены действовать сообща ради внезапной проблемы",
    selections: {
      ensemble: ["old_circle"],
      relationshipStyle: ["rivals_allies"],
      conflict: ["urgent_household"],
      ensembleRoles: ["coordinator", "provocateur"],
      playerAnchor: ["equal_participant"],
    },
  },
  {
    id: "preset_old_circle",
    name: "Старая банда спустя годы",
    hint: "ностальгия встречается с тем, как сильно все изменились",
    selections: {
      ensemble: ["old_circle"],
      tone: ["slow_observation"],
      informationPattern: ["hidden_past"],
      playerAnchor: ["newcomer"],
      ensembleRoles: ["excluded", "cynical_observer"],
    },
  },
  {
    id: "preset_transit",
    name: "Изоляция в пути",
    hint: "случайные попутчики застряли между точками маршрута, и роли постепенно стираются",
    selections: {
      setting: ["journey"],
      ensemble: ["strangers_together"],
      physicalConditions: ["transit_pause"],
      conflict: ["external_intrusion"],
      playerAnchor: ["catalyst"],
    },
  },
  {
    id: "preset_secret_romance",
    name: "Тайный роман в компании",
    hint: "двое скрывают связь от остальных; подтекст остаётся взрослым и ненавязчивым",
    selections: {
      ensemble: ["old_circle"],
      informationPattern: ["secret_pact"],
      groupChemistry: ["hidden_contact"],
      playerAnchor: ["newcomer"],
    },
  },

  // Legacy ids: не показываются в V2 UI, но остаются разрешёнными для старых payload.
  {
    id: "preset_shared_place",
    name: "Общее место",
    hint: "legacy-пресет для сохранённых настроек",
    legacy: true,
    selections: { setting: ["shared_place"], ensemble: ["regulars"] },
  },
  {
    id: "preset_task",
    name: "Общая задача",
    hint: "legacy-пресет для сохранённых настроек",
    legacy: true,
    selections: { ensemble: ["temporary_team"], conflict: ["deadline"] },
  },
  {
    id: "preset_mystery",
    name: "Тайна без готового ответа",
    hint: "legacy-пресет для сохранённых настроек",
    legacy: true,
    selections: { setting: ["mystery_place"], tone: ["quiet_mystery"], conflict: ["missing_fact"] },
  },
  {
    id: "preset_everyday",
    name: "Обычный вечер",
    hint: "legacy-пресет для сохранённых настроек",
    legacy: true,
    selections: { tone: ["warm_everyday"], conflict: ["small_friction"] },
  },
] as const;

export const GROUP_CATALOG: GroupCatalogCategory[] = [
  {
    id: "setting",
    title: "Место и городская среда",
    icon: "📍",
    max: 2,
    note: "Выбирай не жанр мира, а социальный контекст. Group DNA V2 работает в современном реалистичном мире.",
    options: [
      { id: "shared_place", name: "Место, куда возвращаются", hint: "кафе, мастерская, спортзал, библиотека или другое место с постоянными посетителями" },
      { id: "workplace", name: "Рабочая среда", hint: "офис, студия, клиника, редакция или сервис, где роли и обязанности создают трения" },
      { id: "campus", name: "Учёба и кампус", hint: "университет, курсы или совместный проект без школьного контекста" },
      { id: "mystery_place", name: "Полузакрытая рабочая зона", hint: "архив, служебное помещение, подсобка или рабочее место с недостающим фактом" },
      { id: "journey", name: "Дорога и пересадка", hint: "поездка, автобус, электричка, аэропорт или вынужденный маршрут" },
      { id: "neighborhood", name: "Один дом или район", hint: "соседи и знакомые, чьи повседневные маршруты пересекаются" },
      { id: "temporary_housing", name: "Временное жильё", hint: "съёмная квартира, переезд, гостевая комната или временный приют" },
      { id: "public_event", name: "Публичное мероприятие", hint: "очередь, выставка, собрание, локальный праздник или встреча, где нужно держать лицо" },
      { id: "service_backstage", name: "Изнанка городского сервиса", hint: "служебный вход, парковка, курилка, задний двор, ресепшен или техническая зона" },
      // Сохраняем старые ids для legacy caller, но не показываем их в Group DNA V2 UI.
      { id: "fantasy_settlement", name: "Фэнтезийное поселение", hint: "legacy: старый фантазийный контекст" },
      { id: "scifi_station", name: "Станция или корабль", hint: "legacy: старый научно-фантастический контекст" },
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
    id: "playerAnchor",
    title: "Позиция игрока в группе",
    icon: "🧭",
    max: 1,
    note: "Это социальная рамка, а не обязанность игрока смотреть, судить или отвечать.",
    options: [
      { id: "newcomer", name: "Новичок / Чужак", hint: "у компании есть старый общий контекст, а игрока только вводят в круг" },
      { id: "common_friend", name: "Связующее звено", hint: "участники мало знакомы или недолюбливают друг друга, но собрались через игрока" },
      { id: "awkward_witness", name: "Вынужденный свидетель", hint: "личное напряжение происходит рядом, но игрок не обязан наблюдать или вмешиваться" },
      { id: "reluctant_arbiter", name: "Невольный арбитр", hint: "герои могут пытаться заручиться мнением игрока, но игрок не обязан быть судьёй" },
      { id: "equal_participant", name: "Равный соучастник", hint: "игрок входит в общий код и имеет равный голос, без обязательного лидерства" },
      { id: "subordination", name: "Субординация", hint: "перед игроком держат лицо как перед клиентом, гостем или начальником" },
      { id: "attention_rivalry", name: "Объект скрытого соперничества", hint: "между участниками есть азарт за внимание или одобрение, не обязательно романтический" },
      { id: "secret_ally", name: "Тайный союзник одного", hint: "у игрока есть предварительная договорённость, о которой остальные пока не знают" },
      { id: "catalyst", name: "Катализатор перемен", hint: "появление игрока сдвигает привычный статус-кво, но не управляет решениями NPC" },
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
      { id: "adventure", name: "Динамичная ситуация", hint: "движение, риск и решения в современной реальности" },
      { id: "slow_observation", name: "Наблюдательная сцена", hint: "темп через жесты, детали места и разговоры между NPC" },
    ],
  },
  {
    id: "conflict",
    title: "Микро-катализатор момента",
    icon: "⚡",
    max: 2,
    note: "Осязаемый повод для начала, а не готовый финал сюжета.",
    options: [
      { id: "revealed_detail", name: "Случайно вскрывшаяся деталь", hint: "уведомление на телефоне, забытый чек, предмет в чужом кармане или другая наблюдаемая улика" },
      { id: "urgent_household", name: "Срочная бытовая накладка", hint: "потерялись ключи, отключили воду или свет, заглох мотор, захлопнулась дверь" },
      { id: "material_question", name: "Материальный вопрос", hint: "общий счёт, аренда, долг, скидывание денег или признание, что средств не хватает" },
      { id: "emotional_snap", name: "Эмоциональный срыв по пустяку", hint: "пролитый чай или невинная реплика обнажили накопленную усталость" },
      { id: "uncomfortable_question", name: "Неудобный вопрос в лоб", hint: "кто-то нарушил негласное табу и спросил о том, о чём все молчали" },
      { id: "external_intrusion", name: "Внезапное внешнее вторжение", hint: "звонок в дверь, настойчивый вызов или посторонний стук нарушили разговор" },
      { id: "time_ultimatum", name: "Ультиматум времени", hint: "решение нужно принять за несколько минут, иначе возможность будет упущена" },
      { id: "departure_announcement", name: "Заявление об уходе", hint: "один собирает вещи или закрывает рабочий доступ, а остальные впервые реагируют вслух" },
      { id: "privacy_breach", name: "Случайное нарушение приватности", hint: "кто-то зашёл без стука, услышал шёпот или застал другого в уязвимом положении" },
      // Compatibility ids from Group DNA 1.
      { id: "small_friction", name: "Мелкое трение", hint: "legacy: разные привычки или спор о решении" },
      { id: "deadline", name: "Срок и давление", hint: "legacy: времени мало" },
      { id: "missing_fact", name: "Недостающий факт", hint: "legacy: важная деталь неизвестна" },
      { id: "conflicting_goals", name: "Разные цели", hint: "legacy: участники хотят несовпадающие результаты" },
      { id: "resource_choice", name: "Ограниченный ресурс", hint: "legacy: время, место, деньги или доступ нужно распределить" },
      { id: "unexpected_change", name: "Новая перемена", hint: "legacy: обычный план нарушен событием" },
    ],
  },
  {
    id: "physicalConditions",
    title: "Физические условия места",
    icon: "🏙️",
    max: 2,
    advanced: true,
    note: "Фактура ситуации: модель сама придумает конкретную локацию, свет, звук и бытовые детали.",
    options: [
      { id: "cramped_shared_space", name: "Бытовая скученность", hint: "тесное пространство, общие вещи, звук и воздух; разойтись по углам трудно" },
      { id: "night_offhours", name: "Ночной / нерабочий режим", hint: "приглушённый свет, усталость и ослабший социальный контроль" },
      { id: "transit_pause", name: "Транзитная изоляция", hint: "вынужденная остановка между точками маршрута, быстро уйти нельзя" },
      { id: "owned_territory", name: "Чужая территория", hint: "место принадлежит одному человеку или третьей стороне, остальные чувствуют себя гостями" },
      { id: "temporary_shelter", name: "Временный приют / переезд", hint: "коробки, временное жильё и подвешенность вместо устоявшегося быта" },
      { id: "public_face", name: "Публичное место и необходимость держать лицо", hint: "посторонние рядом, поэтому конфликт и флирт выражаются намёками и взглядами" },
      { id: "backstage_urban", name: "Изнанка города / техническая зона", hint: "служебный вход, курилка, парковка или задворки без декоративного лоска" },
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
      { id: "status_hierarchy", name: "Негласная иерархия", hint: "влияние, право решать и социальный вес распределены неравномерно, но не объявлены вслух" },
      { id: "no_romance_default", name: "Без романтической оси", hint: "любая близость остаётся дружеской, профессиональной, семейной или ситуативной, если пользователь явно не задал иное" },
    ],
  },
  {
    id: "ensembleRoles",
    title: "Доминирующие социальные роли",
    icon: "🎭",
    max: 2,
    advanced: true,
    note: "Выбери 1–2 доминанты; остальные роли модель распределит по людям и обстоятельствам.",
    options: [
      { id: "coordinator", name: "Негласный лидер / Координатор", hint: "берёт ответственность, направляет разговор, раздражается на хаос" },
      { id: "provocateur", name: "Провокатор / Смутьян", hint: "вскрывает неудобное под видом шуток и проверяет всех на прочность" },
      { id: "emotional_ground", name: "Эмоциональный громоотвод / Миротворец", hint: "сглаживает углы, заботится о быте и гасит конфликты" },
      { id: "cynical_observer", name: "Циничный скептик / Наблюдатель", hint: "держится в стороне, говорит редко, но замечает главное" },
      { id: "chaotic_impulse", name: "Хаотичный импульс", hint: "действует на эмоциях, путает планы и создаёт поводы для диалога" },
      { id: "tired_pragmatist", name: "Уставший прагматик", hint: "сфокусирован на деле, игнорирует сантименты и хочет закончить" },
      { id: "social_glue", name: "Социальный клей / Душа компании", hint: "спасает от пауз и держит лёгкость, маскируя собственную тревогу" },
      { id: "excluded", name: "Обиженный / Исключённый", hint: "чувствует себя на обочине и болезненно реагирует на чужое сближение" },
    ],
  },
  {
    id: "informationPattern",
    title: "Скрытая информация",
    icon: "🔐",
    max: 2,
    advanced: true,
    note: "Модель распределит, кто что знает, что скрывает и какой наблюдаемый след может это выдать.",
    options: [
      { id: "coalition", name: "Скрытая коалиция", hint: "двое или трое держат общую линию и не посвящают остальных в договорённость" },
      { id: "secret_pact", name: "Тайный сговор", hint: "двое договорились за спиной остальных и переглядываются на определённых темах" },
      { id: "hidden_past", name: "Скрываемое прошлое", hint: "двое когда-то были близки или пережили разрыв, но держат дистанцию" },
      { id: "resource_dependency", name: "Ресурсная зависимость", hint: "деньги, услуга, жильё или работа создают скрытое напряжение власти" },
      { id: "uneven_triangle", name: "Неравный треугольник привязанности", hint: "А тянется к Б, Б этого не замечает и проявляет интерес к игроку или другому" },
      { id: "shame_secret", name: "Чужой постыдный секрет", hint: "один знает об уязвимости, провале или лжи другого" },
      { id: "split_loyalty", name: "Лояльность на грани раскола", hint: "один уже решил уйти из компании или проекта, остальные не знают" },
      { id: "shared_blame", name: "Общая вина или ошибка", hint: "несколько участников пытаются замять бытовую оплошность и её последствия" },
      { id: "status_competition", name: "Конкуренция за статус", hint: "скрытое соперничество за влияние, лидерство или внимание" },
    ],
  },
  {
    id: "groupChemistry",
    title: "Взрослый подтекст и химия",
    icon: "🔥",
    max: 2,
    advanced: true,
    adultOnly: true,
    note: "Работает только при включённом профиле 18+ и не превращает обычную сцену в секс.",
    options: [
      { id: "elephant_room", name: "Электрический подтекст", hint: "влечение между двумя заметно окружающим, но скрываемое за подколками или сухостью" },
      { id: "sensory_closeness", name: "Сенсорная теснота", hint: "ситуация вынуждает замечать тепло, запахи, расстояние и случайные касания" },
      { id: "hidden_contact", name: "Конспирация и тайный контакт", hint: "двое скрывают романтическую связь от остальных через жесты и обычные фразы" },
      { id: "flirt_competition", name: "Флирт-соперничество", hint: "двое соревнуются за внимание игрока без права требовать его реакции" },
      { id: "filters_off", name: "Слёт социальных фильтров", hint: "усталость, стресс или добровольно упомянутый алкоголь ослабили обычную вежливость" },
      { id: "jealousy_witnessed", name: "Ревность на глазах у свидетелей", hint: "собственническая реакция прячется за сарказмом или холодностью, но не оправдывает контроль" },
      { id: "double_meaning", name: "Двойные намёки", hint: "бытовая фраза несёт конкретный личный смысл только для двоих" },
    ],
  },
];

export function resolveGroupAge(id: string): string {
  return GROUP_AGE_BANDS.find((item) => item.id === id)?.hint ?? "все персонажи совершеннолетние, возраст выбери правдоподобно";
}

export function resolveGroupPreferencesBlock(prefs: GroupPreferences): string {
  const selected: string[] = [];
  for (const category of GROUP_CATALOG) {
    if (category.adultOnly && !prefs.adultEnabled) continue;
    const ids = prefs.selections?.[category.id] ?? [];
    for (const option of category.options) {
      if (option.hint.startsWith("legacy:") && !ids.includes(option.id)) continue;
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
    "Мир: современная реалистичная действительность без магии, космоса, фэнтези и сверхъестественных объяснений.",
    prefs.adultEnabled
      ? "Взрослый контекст разрешён только для совершеннолетних и только при естественной взаимности; не переводить всю сцену в секс."
      : "Взрослый профиль не запрошен: не сексуализировать обычную сцену и вернуть chemistry пустым.",
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

export function presetEnablesAdult(presetId: string): boolean {
  return presetId === "preset_secret_romance";
}
