import { v4 as uuidv4 } from 'uuid';
import { requestV2Json } from './v2/provider';
import { applyMysteryModeToCharacter, applyMysteryModeToGroup } from './mysteryMode';
import type { Character, LoreEntry, RelationshipStats } from '../types';

export type TextDnaMode = 'single' | 'group';

export type TextDnaErrorKind =
  | 'context'
  | 'output_limit'
  | 'empty_response'
  | 'no_json'
  | 'invalid_json'
  | 'incomplete_json'
  | 'schema'
  | 'provider'
  | 'api'
  | 'unknown';

export class TextDnaError extends Error {
  public readonly kind: TextDnaErrorKind;
  public readonly stage: string;
  public readonly retryable: boolean;
  public readonly rawResponse?: string;

  constructor(
    message: string,
    options: {
      kind: TextDnaErrorKind;
      stage?: string;
      retryable?: boolean;
      rawResponse?: string;
    }
  ) {
    super(message);
    this.name = 'TextDnaError';
    this.kind = options.kind;
    this.stage = options.stage ?? 'extract';
    this.retryable = options.retryable ?? true;
    this.rawResponse = options.rawResponse;
  }
}

/**
 * Бюджеты токенов вывода по аналогии с GroupDNA V2 (GROUP_MAX_TOKENS = 7600)
 * и Character DNA V2: весь входной текст обрабатывается за 1 прямой запрос
 * (+1 страховочная коррекция только при ошибке валидации JSON/схемы).
 */
export const TEXT_DNA_MAX_ATTEMPTS = 2;
export const TEXT_DNA_SINGLE_MAX_TOKENS = 6000;
export const TEXT_DNA_GROUP_MAX_TOKENS = 7600;
export const TEXT_DNA_TEMPERATURE = 0.2;

export interface TextDnaLoreDraft {
  title: string;
  content: string;
  keywords: string[];
  category?: string;
}

export interface TextDnaCharacter {
  name: string;
  aliases: string[];
  tagline: string;
  age: string;
  genre: string;
  tags: string[];
  firstImpression: string;
  startingPoint: string;
  summaryQuote: string;
  description: string;
  personality: string;
  scenario: string;
  systemPrompt: string;
  firstMessage: string;
  alternateGreetings: string[];
  secrets: string;
  knowledgeBoundaries: string;
  initialStats: RelationshipStats;
  lorebook: TextDnaLoreDraft[];
  preservedMaterial: string;
}

export interface TextDnaRelation {
  fromName: string;
  toName: string;
  type: string;
  description: string;
  trust: number;
  tension: number;
  secretNote?: string;
}

export interface TextDnaSessionData {
  title: string;
  scenario: string;
  startingPoint: string;
  firstMessage: string;
  alternateGreetings: string[];
  authorRules: string;
  lorebook: TextDnaLoreDraft[];
  preservedMaterial: string;
}

export interface TextDnaSceneData {
  title: string;
  setting: string;
  premise: string;
  currentMoment: string;
  tone: string;
  firstMessage: string;
  alternateGreetings: string[];
  authorRules: string;
  lorebook: TextDnaLoreDraft[];
  preservedMaterial: string;
}

export interface TextDnaCoverage {
  inputChars: number;
  estimatedInputTokens: number;
  apiRequestsCount: number;
  characterCount: number;
  loreCount: number;
  preservedRulesCount: number;
  hasFirstMessage: boolean;
}

export interface TextDnaSinglePayload {
  mode: 'single';
  character: TextDnaCharacter;
  session: TextDnaSessionData;
  preservedMaterial: string;
  coverage: TextDnaCoverage;
}

export interface TextDnaGroupPayload {
  mode: 'group';
  scene: TextDnaSceneData;
  characters: TextDnaCharacter[];
  relations: TextDnaRelation[];
  preservedMaterial: string;
  coverage: TextDnaCoverage;
}

export type TextDnaPayload = TextDnaSinglePayload | TextDnaGroupPayload;

export interface TextDnaPreparedSingle {
  mode: 'single';
  payload: TextDnaSinglePayload;
  character: Character;
  loreEntries: LoreEntry[];
  session: TextDnaSessionData;
  coverage: TextDnaCoverage;
  mysteryMode?: boolean;
}

export interface TextDnaPreparedGroup {
  mode: 'group';
  payload: TextDnaGroupPayload;
  characters: Character[];
  loreEntries: LoreEntry[];
  scene: TextDnaSceneData;
  relations: TextDnaRelation[];
  coverage: TextDnaCoverage;
  mysteryMode?: boolean;
}

export type TextDnaResult = TextDnaPreparedSingle | TextDnaPreparedGroup;

export type TextDnaStage = 'idle' | 'extracting' | 'correcting' | 'completed' | 'error';

export interface TextDnaTask {
  id: string;
  mode: TextDnaMode;
  sourceText: string;
  preferredLanguage: string;
  stage: TextDnaStage;
  progress: number;
  message: string;
  attempts: number;
  rawDraft?: string;
  validationErrors?: string[];
  result?: TextDnaResult;
  error?: TextDnaError;
}

export interface ExtractTextDnaOptions {
  text: string;
  mode: TextDnaMode;
  preferredLanguage?: string;
  mysteryMode?: boolean;
  task?: TextDnaTask;
  onProgress?: (task: TextDnaTask) => void;
  requestJsonFn?: (params: {
    systemPrompt: string;
    userPrompt: string;
    maxTokens: number;
    temperature?: number;
  }) => Promise<unknown>;
}

export function createTextDnaTask(
  text: string,
  mode: TextDnaMode,
  preferredLanguage = 'ru'
): TextDnaTask {
  return {
    id: uuidv4(),
    mode,
    sourceText: text,
    preferredLanguage,
    stage: 'idle',
    progress: 0,
    message: 'Готов к извлечению структуры...',
    attempts: 0,
  };
}

function clampStat(val: unknown, fallback = 50, min = -100, max = 100): number {
  const num = typeof val === 'number' ? val : Number(val);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

function asString(val: unknown, fallback = ''): string {
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  return fallback;
}

function asStringArray(val: unknown): string[] {
  if (Array.isArray(val)) {
    return val
      .map((item) => asString(item))
      .filter((item) => item.length > 0);
  }
  if (typeof val === 'string' && val.trim().length > 0) {
    return val
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeLoreDrafts(raw: unknown): TextDnaLoreDraft[] {
  if (!Array.isArray(raw)) return [];
  const drafts: TextDnaLoreDraft[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const title = asString(rec.title || rec.name || rec.topic);
    const content = asString(rec.content || rec.description || rec.text);
    if (!title && !content) continue;
    const keywords = asStringArray(rec.keywords || rec.keys || rec.triggers);
    drafts.push({
      title: title || 'Запись лора',
      content,
      keywords: keywords.length > 0 ? keywords : title ? [title] : [],
      category: asString(rec.category, 'lore'),
    });
  }
  return drafts;
}

/**
 * Системный промпт прямого экстрактора (по архитектуре GroupDNA V2 / Character DNA V2,
 * но без жанровых пресетов и без творческого додумывания).
 */
export function buildTextDnaSystemPrompt(mode: TextDnaMode, preferredLanguage = 'ru'): string {
  const langInstruction =
    preferredLanguage === 'ru'
      ? 'Формируй все поля карточек на русском языке (сохраняя оригинальные имена собственные, термины или иноязычные реплики, если они важны по тексту).'
      : `Output all extracted fields in ${preferredLanguage}.`;

  const commonRules = [
    'Ты — точный архивариус-экстрактор TextDNA для ролевой платформы NOCTURNE.',
    'Твоя задача — за ОДИН прямой проход преобразовать пользовательский исходный текст (даже если он огромный, на 10 000–50 000 токенов) в компактные, ёмкие, структурно плотные карточки персонажей и параметры сцены.',
    'КРИТИЧЕСКИЕ ПРАВИЛА ТОЧНОСТИ И СЖАТИЯ:',
    '1. НИКАКИХ ПРЕСЕТОВ И ОТСЕБЯТИНЫ: Не используй внешние шаблоны. Не придумывай отсутствующие факты, возраст, биографию или мотивы, если их нет в исходном тексте. Если деталь не указана — оставь строку пустой ("") или массив пустым ([]).',
    '2. НЕ РАЗРЕШАЙ ПРОТИВОРЕЧИЯ: Если в исходном тексте есть неоднозначности, несостыковки или конфликтующие версии событий — зафиксируй обе версии как есть, не выбирая одну за автора.',
    '3. ТЕЗИСНОЕ УПЛОТНЕНИЕ БЕЗ ПОТЕРИ СУТИ: Не копируй сырые простыни на десятки тысяч слов целиком в одно поле, чтобы не раздувать контекст чата. Сжимай длинные описания в плотные, информативные тезисы, сохраняя 100% конкретики: точные факты, триггеры, привычки, внешний вид, манеру речи и биографические вехи.',
    '4. ОБЯЗАТЕЛЬНОЕ СОХРАНЕНИЕ 8 КАТЕГОРИЙ ДАННЫХ:',
    '   - Идентичность и альтернативные обозначения: основное имя в `name`, все прозвища, титулы, позывные, фамилии и формы обращения от разных лиц — в `aliases` и `description`.',
    '   - Внешность, характер и биография: плотные тезисы со всеми конкретными деталями в `description` и `personality`.',
    '   - Отношения и общая сцена: завязка, локация, расстановка сил и направленные связи между участниками (`relations`).',
    '   - Авторские инструкции и ограничения: все системные правила, OOC-указания, запреты и требования к стилю повествования не сокращай до общих фраз — бережно перенеси их в `systemPrompt` и `authorRules`.',
    '   - Индивидуальные секреты и асимметрия знаний: чётко отдели публичную информацию от тайной. Запиши в `secrets` личные тайны персонажа, а в `knowledgeBoundaries` — что персонаж ЗНАЕТ и чего он НЕ ЗНАЕТ о других и о ситуации.',
    '   - Первые сообщения и исходные диалоги: если в тексте есть готовый стартовый пост, приветствие или начальный диалог — перенеси его в `firstMessage` (а дополнительные варианты — в `alternateGreetings`) максимально близко к оригиналу.',
    '   - Прочие существенные сведения без отдельного поля: важные правила мира, артефакты, локации и фракции оформи в `lorebook`, а специфические заметки и условия, не вошедшие в другие поля — в `preservedMaterial`.',
    langInstruction,
    'Верни ТОЛЬКО валидный JSON-объект без markdown-обёрток и пояснений вне JSON.',
  ].join('\n');

  if (mode === 'single') {
    return [
      commonRules,
      '',
      'СХЕМА JSON ДЛЯ ОДИНОЧНОГО РЕЖИМА ("mode": "single"):',
      '{',
      '  "mode": "single",',
      '  "character": {',
      '    "name": "Основное имя персонажа",',
      '    "aliases": ["прозвище", "титул", "как его называют другие"],',
      '    "tagline": "Краткая роль или статус строго по тексту",',
      '    "age": "Возраст (если есть в тексте, иначе пустая строка)",',
      '    "genre": "Жанр/сеттинг по тексту",',
      '    "tags": ["тег1", "тег2"],',
      '    "firstImpression": "Внешность и первое впечатление (плотные тезисы без потери деталей)",',
      '    "startingPoint": "В какой точке и состоянии персонаж находится на старте",',
      '    "summaryQuote": "Характерная реплика или цитата из текста (если есть)",',
      '    "description": "Подробное тезисное описание: внешность, биография, прошлое, способности, статус, все альтернативные обозначения",',
      '    "personality": "Характер, психология, манера речи, привычки, триггеры, мотивация",',
      '    "scenario": "Контекст текущей сцены и взаимодействия с пользователем/игроком",',
      '    "systemPrompt": "Авторские инструкции, правила отыгрыша, ограничения, стиль речи и OOC-требования для этого персонажа",',
      '    "secrets": "Индивидуальные секреты, скрытые мотивы и тайные факты персонажа",',
      '    "knowledgeBoundaries": "Асимметрия знаний: что персонаж знает точно, о чём догадывается, а чего НЕ знает",',
      '    "firstMessage": "Первое сообщение / стартовая сцена из текста (если есть)",',
      '    "alternateGreetings": ["Альтернативные стартовые реплики или диалоги из текста"],',
      '    "initialStats": { "affection": 0, "trust": 0, "respect": 0, "tension": 0 },',
      '    "lorebook": [{ "title": "Название", "content": "Факты", "keywords": ["ключ1"] }],',
      '    "preservedMaterial": "Все важные детали, правила и нюансы персонажа, не имеющие отдельного поля"',
      '  },',
      '  "session": {',
      '    "title": "Название истории или сцены",',
      '    "scenario": "Общая завязка и экспозиция сцены",',
      '    "startingPoint": "Точка старта диалога",',
      '    "firstMessage": "Стартовое сообщение сессии",',
      '    "alternateGreetings": [],',
      '    "authorRules": "Глобальные авторские инструкции, правила мира и ограничения отыгрыша",',
      '    "lorebook": [{ "title": "Лор мира", "content": "Описание", "keywords": ["ключ"] }],',
      '    "preservedMaterial": "Прочие существенные сведения об истории и мире"',
      '  },',
      '  "preservedMaterial": "Сводка всех особых авторских правил и нестандартных блоков"',
      '}',
    ].join('\n');
  }

  return [
    commonRules,
    '',
    'СХЕМА JSON ДЛЯ ГРУППОВОГО РЕЖИМА ("mode": "group"):',
    '{',
    '  "mode": "group",',
    '  "scene": {',
    '    "title": "Название групповой сцены / истории",',
    '    "setting": "Мир, локация и декорации строго по тексту",',
    '    "premise": "Общая завязка, конфликт и предыстория группы",',
    '    "currentMoment": "Что происходит прямо сейчас в стартовой точке",',
    '    "tone": "Тональность и атмосфера из текста",',
    '    "firstMessage": "Стартовое сообщение или открывающий диалог сцены (сохранить из текста)",',
    '    "alternateGreetings": ["Дополнительные стартовые сцены/диалоги, если были в тексте"],',
    '    "authorRules": "Глобальные авторские инструкции, правила ролевой, OOC-ограничения и механики",',
    '    "lorebook": [{ "title": "Название статьи лора", "content": "Плотные факты из текста", "keywords": ["ключ"] }],',
    '    "preservedMaterial": "Важные детали мира и сцены, для которых нет отдельного поля"',
    '  },',
    '  "characters": [',
    '    {',
    '      "name": "Основное имя персонажа",',
    '      "aliases": ["прозвища", "альтернативные имена", "обращения"],',
    '      "tagline": "Роль в группе / краткий статус",',
    '      "age": "Возраст (если указан)",',
    '      "genre": "Жанр/архетип по тексту",',
    '      "tags": ["тег1", "тег2"],',
    '      "firstImpression": "Внешность и подача (плотные тезисы)",',
    '      "startingPoint": "Позиция и состояние персонажа на начало сцены",',
    '      "summaryQuote": "Характерная цитата или пример речи из исходного текста",',
    '      "description": "Тезисная, но полная выжимка: внешность, биография, способности, прошлое, альтернативные имена",',
    '      "personality": "Характер, психология, манера речи, привычки, отношение к группе",',
    '      "scenario": "Личная задача и положение персонажа в текущей сцене",',
    '      "systemPrompt": "Личные авторские инструкции, ограничения отыгрыша и правила поведения этого персонажа",',
    '      "secrets": "Личные тайны и скрытые действия персонажа (неизвестные остальным)",',
    '      "knowledgeBoundaries": "Что этот персонаж ЗНАЕТ и чего НЕ ЗНАЕТ о других участниках и тайнах сцены",',
    '      "firstMessage": "Личная стартовая реплика персонажа (если выделена отдельно)",',
    '      "alternateGreetings": [],',
    '      "initialStats": { "affection": 0, "trust": 0, "respect": 0, "tension": 0 },',
    '      "lorebook": [],',
    '      "preservedMaterial": "Специфические детали персонажа без отдельного поля"',
    '    }',
    '  ],',
    '  "relations": [',
    '    {',
    '      "fromName": "Имя персонажа А",',
    '      "toName": "Имя персонажа Б (или Игрок/Пользователь)",',
    '      "type": "Тип связи (например: союзники, бывшие, соперники, начальник/подчинённый)",',
    '      "description": "Подробная динамика отношений, история, взаимные чувства и претензии по тексту",',
    '      "trust": 0,',
    '      "tension": 50,',
    '      "secretNote": "Скрытая сторона отношений, о которой знает только одна сторона (если есть)"',
    '    }',
    '  ],',
    '  "preservedMaterial": "Общий блок нестандартных правил, таблиц или условий из исходного промпта"',
    '}',
  ].join('\n');
}

export function buildTextDnaUserPrompt(text: string, mode: TextDnaMode): string {
  return [
    '=== ИСХОДНЫЙ МАТЕРИАЛ ДЛЯ ИЗВЛЕЧЕНИЯ (TEXT DNA SOURCE) ===',
    text.trim(),
    '=== КОНЕЦ ИСХОДНОГО МАТЕРИАЛА ===',
    '',
    mode === 'single'
      ? 'Извлеки из приведённого выше материала полную карточку одиночного персонажа и параметры сессии в формате JSON ("mode": "single"). Сформируй плотные, точные тезисы без потери ни одной важной детали, секрета, альтернативного имени, первого сообщения или авторского правила.'
      : 'Извлеки из приведённого выше материала полную групповую сцену, карточки ВСЕХ персонажей ансамбля и граф их отношений в формате JSON ("mode": "group"). Сформируй плотные, точные тезисы без потери идентичности, альтернативных имён, секретов, различий в знаниях, стартовых диалогов и авторских инструкций.',
  ].join('\n');
}

export function buildTextDnaCorrectionPrompt(
  originalUserPrompt: string,
  rawDraft: string,
  errors: string[],
  mode: TextDnaMode
): string {
  return [
    originalUserPrompt,
    '',
    '=== ОШИБКИ В ПРЕДЫДУЩЕМ ОТВЕТЕ ===',
    'Твой предыдущий JSON не прошёл проверку структуры:',
    ...errors.map((err, idx) => `${idx + 1}. ${err}`),
    '',
    'Предыдущий черновик (фрагмент):',
    rawDraft.slice(0, 12000),
    '',
    `Исправь ошибки и верни полный валидный JSON для режима "${mode}" строго по схеме, сохранив все извлечённые факты, секреты, альтернативные имена, первые сообщения и авторские инструкции.`,
  ].join('\n');
}

function normalizeCharacter(
  raw: Record<string, unknown>,
  fallbackScenario = '',
  globalAuthorRules = ''
): TextDnaCharacter {
  const name = asString(raw.name || raw.characterName || raw.title);
  const aliases = asStringArray(raw.aliases || raw.alternativeNames || raw.nicknames);
  const tagline = asString(raw.tagline || raw.role || raw.archetype);
  const age = asString(raw.age);
  const genre = asString(raw.genre);
  const tags = asStringArray(raw.tags);
  const firstImpression = asString(raw.firstImpression || raw.appearance);
  const startingPoint = asString(raw.startingPoint || raw.initialState);
  const summaryQuote = asString(raw.summaryQuote || raw.quote || raw.speechSample);
  const rawDescription = asString(raw.description || raw.biography || raw.backstory);
  const rawPersonality = asString(raw.personality || raw.character || raw.psychology);
  const scenario = asString(raw.scenario) || fallbackScenario;
  const secrets = asString(raw.secrets || raw.secret || raw.hiddenInfo);
  const knowledgeBoundaries = asString(
    raw.knowledgeBoundaries || raw.knowledge || raw.asymmetryOfKnowledge
  );
  const preservedMaterial = asString(raw.preservedMaterial || raw.extraNotes || raw.notes);
  const rawSystemPrompt = asString(raw.systemPrompt || raw.authorInstructions || raw.rules);

  const aliasLine =
    aliases.length > 0 && !rawDescription.includes(aliases[0])
      ? `Альтернативные имена и обращения: ${aliases.join(', ')}.`
      : '';

  const descriptionParts = [aliasLine, rawDescription].filter(Boolean);
  const description = descriptionParts.join('\n\n');

  const systemPromptParts = [
    rawSystemPrompt,
    globalAuthorRules && !rawSystemPrompt.includes(globalAuthorRules)
      ? `Авторские правила и ограничения: ${globalAuthorRules}`
      : '',
    secrets ? `Личные секреты персонажа: ${secrets}` : '',
    knowledgeBoundaries ? `Границы знаний (что знает / чего НЕ знает): ${knowledgeBoundaries}` : '',
    preservedMaterial ? `Дополнительные сведения из источника: ${preservedMaterial}` : '',
  ].filter(Boolean);

  const statsRaw =
    raw.initialStats && typeof raw.initialStats === 'object'
      ? (raw.initialStats as Record<string, unknown>)
      : {};

  const initialStats: RelationshipStats = {
    affection: clampStat(statsRaw.affection, 0, -100, 100),
    trust: clampStat(statsRaw.trust, 0, -100, 100),
    respect: clampStat(statsRaw.respect, 0, -100, 100),
    tension: clampStat(statsRaw.tension, 0, 0, 100),
  };

  return {
    name,
    aliases,
    tagline,
    age,
    genre,
    tags: Array.from(new Set([...tags, ...aliases].filter(Boolean))),
    firstImpression: firstImpression || description.slice(0, 240),
    startingPoint,
    summaryQuote,
    description: description || firstImpression,
    personality: rawPersonality,
    scenario,
    systemPrompt: systemPromptParts.join('\n\n'),
    firstMessage: asString(raw.firstMessage || raw.greeting || raw.openingMessage),
    alternateGreetings: asStringArray(raw.alternateGreetings),
    secrets,
    knowledgeBoundaries,
    initialStats,
    lorebook: normalizeLoreDrafts(raw.lorebook),
    preservedMaterial,
  };
}

export function validateAndNormalizeTextDnaPayload(
  raw: unknown,
  expectedMode: TextDnaMode,
  sourceText: string,
  apiRequestsCount: number
): { payload?: TextDnaPayload; errors: string[] } {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { errors: ['Ответ модели не является JSON-объектом.'] };
  }

  const root = raw as Record<string, unknown>;
  const estimatedInputTokens = Math.max(1, Math.ceil(sourceText.length / 3.8));

  if (expectedMode === 'single') {
    const rawChar =
      root.character && typeof root.character === 'object'
        ? (root.character as Record<string, unknown>)
        : root;
    const rawSession =
      root.session && typeof root.session === 'object'
        ? (root.session as Record<string, unknown>)
        : {};

    const session: TextDnaSessionData = {
      title: asString(rawSession.title || rawChar.name, 'История'),
      scenario: asString(rawSession.scenario || rawChar.scenario || root.scenario),
      startingPoint: asString(rawSession.startingPoint || rawChar.startingPoint),
      firstMessage: asString(rawSession.firstMessage || rawChar.firstMessage),
      alternateGreetings: asStringArray(
        rawSession.alternateGreetings || rawChar.alternateGreetings
      ),
      authorRules: asString(rawSession.authorRules || root.authorRules || rawChar.systemPrompt),
      lorebook: normalizeLoreDrafts(rawSession.lorebook || root.lorebook),
      preservedMaterial: asString(rawSession.preservedMaterial || root.preservedMaterial),
    };

    const character = normalizeCharacter(rawChar, session.scenario, session.authorRules);
    if (!character.name) {
      errors.push('Поле character.name обязательно и не может быть пустым.');
    }
    if (!character.description && !character.personality && !character.systemPrompt) {
      errors.push(
        'Карточка персонажа должна содержать хотя бы описание (description), характер (personality) или инструкции (systemPrompt).'
      );
    }

    if (errors.length > 0) {
      return { errors };
    }

    if (!character.firstMessage && session.firstMessage) {
      character.firstMessage = session.firstMessage;
    } else if (!session.firstMessage && character.firstMessage) {
      session.firstMessage = character.firstMessage;
    }

    const combinedPreserved = [
      asString(root.preservedMaterial),
      session.preservedMaterial,
      character.preservedMaterial,
    ]
      .filter(Boolean)
      .filter((v, idx, arr) => arr.indexOf(v) === idx)
      .join('\n\n');

    const coverage: TextDnaCoverage = {
      inputChars: sourceText.length,
      estimatedInputTokens,
      apiRequestsCount,
      characterCount: 1,
      loreCount: character.lorebook.length + session.lorebook.length,
      preservedRulesCount: [
        character.systemPrompt,
        session.authorRules,
        character.secrets,
        character.knowledgeBoundaries,
      ].filter(Boolean).length,
      hasFirstMessage: Boolean(character.firstMessage || session.firstMessage),
    };

    return {
      errors: [],
      payload: {
        mode: 'single',
        character,
        session,
        preservedMaterial: combinedPreserved,
        coverage,
      },
    };
  }

  const rawScene =
    root.scene && typeof root.scene === 'object' ? (root.scene as Record<string, unknown>) : {};
  const rawCharacters = Array.isArray(root.characters) ? root.characters : [];
  const rawRelations = Array.isArray(root.relations) ? root.relations : [];

  const scene: TextDnaSceneData = {
    title: asString(rawScene.title || root.title, 'Групповая сцена'),
    setting: asString(rawScene.setting || root.setting),
    premise: asString(rawScene.premise || rawScene.scenario || root.premise),
    currentMoment: asString(rawScene.currentMoment || rawScene.startingPoint),
    tone: asString(rawScene.tone),
    firstMessage: asString(rawScene.firstMessage || root.firstMessage),
    alternateGreetings: asStringArray(rawScene.alternateGreetings || root.alternateGreetings),
    authorRules: asString(rawScene.authorRules || root.authorRules),
    lorebook: normalizeLoreDrafts(rawScene.lorebook || root.lorebook),
    preservedMaterial: asString(rawScene.preservedMaterial || root.preservedMaterial),
  };

  const sceneScenarioFallback = [scene.setting, scene.premise, scene.currentMoment]
    .filter(Boolean)
    .join('\n');

  const characters: TextDnaCharacter[] = [];
  for (const item of rawCharacters) {
    if (!item || typeof item !== 'object') continue;
    const ch = normalizeCharacter(
      item as Record<string, unknown>,
      sceneScenarioFallback,
      scene.authorRules
    );
    if (ch.name) {
      characters.push(ch);
    }
  }

  if (characters.length === 0) {
    errors.push('В групповом режиме должен быть извлечён хотя бы один персонаж в массиве characters.');
  }

  for (const ch of characters) {
    if (!ch.description && !ch.personality && !ch.systemPrompt) {
      errors.push(`У персонажа "${ch.name}" отсутствуют описание, характер и инструкции.`);
    }
  }

  if (errors.length > 0) {
    return { errors };
  }

  const relations: TextDnaRelation[] = [];
  for (const rel of rawRelations) {
    if (!rel || typeof rel !== 'object') continue;
    const r = rel as Record<string, unknown>;
    const fromName = asString(r.fromName || r.from || r.fromKey);
    const toName = asString(r.toName || r.to || r.toKey);
    if (!fromName || !toName) continue;
    relations.push({
      fromName,
      toName,
      type: asString(r.type || r.relationType, 'связь'),
      description: asString(r.description || r.summary),
      trust: clampStat(r.trust, 0, -100, 100),
      tension: clampStat(r.tension, 0, 0, 100),
      secretNote: asString(r.secretNote || r.secret) || undefined,
    });
  }

  if (!scene.firstMessage) {
    const firstWithGreeting = characters.find((c) => Boolean(c.firstMessage));
    if (firstWithGreeting) {
      scene.firstMessage = firstWithGreeting.firstMessage;
    }
  }

  const combinedPreserved = [
    asString(root.preservedMaterial),
    scene.preservedMaterial,
    ...characters.map((c) =>
      c.preservedMaterial ? `[${c.name}]: ${c.preservedMaterial}` : ''
    ),
  ]
    .filter(Boolean)
    .filter((v, idx, arr) => arr.indexOf(v) === idx)
    .join('\n\n');

  const totalLore =
    scene.lorebook.length + characters.reduce((acc, c) => acc + c.lorebook.length, 0);
  const preservedRulesCount =
    (scene.authorRules ? 1 : 0) +
    characters.reduce(
      (acc, c) =>
        acc + [c.systemPrompt, c.secrets, c.knowledgeBoundaries].filter(Boolean).length,
      0
    );

  const coverage: TextDnaCoverage = {
    inputChars: sourceText.length,
    estimatedInputTokens,
    apiRequestsCount,
    characterCount: characters.length,
    loreCount: totalLore,
    preservedRulesCount,
    hasFirstMessage: Boolean(scene.firstMessage || characters.some((c) => c.firstMessage)),
  };

  return {
    errors: [],
    payload: {
      mode: 'group',
      scene,
      characters,
      relations,
      preservedMaterial: combinedPreserved,
      coverage,
    },
  };
}

function toCharacterEntity(draft: TextDnaCharacter, now: number): Character {
  return {
    id: uuidv4(),
    name: draft.name,
    tagline: draft.tagline || draft.genre || 'Персонаж TextDNA',
    age: draft.age || '',
    genre: draft.genre || 'Ролевая история',
    tags: draft.tags,
    avatar: '',
    firstImpression: draft.firstImpression || draft.description.slice(0, 220),
    startingPoint: draft.startingPoint || draft.scenario,
    summaryQuote: draft.summaryQuote || '',
    description: draft.description,
    personality: draft.personality,
    scenario: draft.scenario,
    systemPrompt: draft.systemPrompt,
    firstMessage: draft.firstMessage,
    alternateGreetings: draft.alternateGreetings,
    initialStats: draft.initialStats,
    createdAt: now,
    updatedAt: now,
  } as Character;
}

function toLoreEntries(
  drafts: TextDnaLoreDraft[],
  characterId?: string,
  now = Date.now()
): LoreEntry[] {
  return drafts.map((d) => ({
    id: uuidv4(),
    title: d.title,
    content: d.content,
    keywords: d.keywords,
    characterId,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  })) as LoreEntry[];
}

export function prepareTextDnaResult(
  payload: TextDnaPayload,
  mysteryMode = false
): TextDnaResult {
  const now = Date.now();

  if (payload.mode === 'single') {
    const baseCharacter = toCharacterEntity(payload.character, now);
    const character = mysteryMode
      ? applyMysteryModeToCharacter(baseCharacter)
      : baseCharacter;

    const allLoreDrafts = [...payload.session.lorebook, ...payload.character.lorebook];
    const loreEntries = toLoreEntries(allLoreDrafts, character.id, now);

    return {
      mode: 'single',
      payload,
      character,
      loreEntries,
      session: payload.session,
      coverage: payload.coverage,
      mysteryMode,
    };
  }

  const baseCharacters = payload.characters.map((ch) => toCharacterEntity(ch, now));
  const characters = mysteryMode
    ? applyMysteryModeToGroup(baseCharacters)
    : baseCharacters;

  const loreEntries: LoreEntry[] = [
    ...toLoreEntries(payload.scene.lorebook, undefined, now),
    ...payload.characters.flatMap((ch, idx) =>
      toLoreEntries(ch.lorebook, characters[idx]?.id, now)
    ),
  ];

  return {
    mode: 'group',
    payload,
    characters,
    loreEntries,
    scene: payload.scene,
    relations: payload.relations,
    coverage: payload.coverage,
    mysteryMode,
  };
}

function classifyProviderError(err: unknown, stage: string): TextDnaError {
  if (err instanceof TextDnaError) return err;
  const msg = err instanceof Error ? err.message : String(err ?? 'Неизвестная ошибка');
  const lower = msg.toLowerCase();

  if (lower.includes('context') || lower.includes('too long') || lower.includes('maximum context')) {
    return new TextDnaError(
      'Исходный текст превысил лимит входного контекста выбранной модели. Выберите модель с большим контекстным окном в настройках.',
      { kind: 'context', stage, retryable: false, rawResponse: msg }
    );
  }
  if (lower.includes('length') || lower.includes('max_tokens') || lower.includes('output_limit')) {
    return new TextDnaError(
      'Ответ модели оборвался на ограничении длины вывода.',
      { kind: 'output_limit', stage, retryable: true, rawResponse: msg }
    );
  }
  if (lower.includes('json')) {
    return new TextDnaError(
      'Модель вернула некорректный JSON. Повторите попытку.',
      { kind: 'invalid_json', stage, retryable: true, rawResponse: msg }
    );
  }
  return new TextDnaError(msg, { kind: 'api', stage, retryable: true, rawResponse: msg });
}

/**
 * Основная точка входа TextDNA:
 * Прямой однозапросный пайплайн по принципу GroupDNA V2 (requestV2Json),
 * без чанкинга и без промежуточного реестра свидетельств.
 */
export async function extractTextDna(options: ExtractTextDnaOptions): Promise<TextDnaResult> {
  const {
    text,
    mode,
    preferredLanguage = 'ru',
    mysteryMode = false,
    onProgress,
    requestJsonFn,
  } = options;

  const trimmed = (text ?? '').trim();
  if (!trimmed) {
    throw new TextDnaError('Введите или загрузите исходный текст для извлечения.', {
      kind: 'schema',
      stage: 'input',
      retryable: false,
    });
  }

  const task = options.task ?? createTextDnaTask(trimmed, mode, preferredLanguage);
  if (task.result && task.sourceText === trimmed && task.mode === mode) {
    return prepareTextDnaResult(task.result.payload, mysteryMode);
  }

  const systemPrompt = buildTextDnaSystemPrompt(mode, preferredLanguage);
  const baseUserPrompt = buildTextDnaUserPrompt(trimmed, mode);
  const maxTokens =
    mode === 'group' ? TEXT_DNA_GROUP_MAX_TOKENS : TEXT_DNA_SINGLE_MAX_TOKENS;

  const callJson =
    requestJsonFn ??
    (async (params: {
      systemPrompt: string;
      userPrompt: string;
      maxTokens: number;
      temperature?: number;
    }) =>
      requestV2Json({
        systemPrompt: params.systemPrompt,
        userPrompt: params.userPrompt,
        maxTokens: params.maxTokens,
        temperature: params.temperature ?? TEXT_DNA_TEMPERATURE,
      }));

  let lastErrors: string[] = [];
  let lastRawDraft = task.rawDraft ?? '';

  for (let attempt = 1; attempt <= TEXT_DNA_MAX_ATTEMPTS; attempt++) {
    const isCorrection = attempt > 1 && lastErrors.length > 0;
    task.stage = isCorrection ? 'correcting' : 'extracting';
    task.attempts = attempt;
    task.progress = isCorrection ? 65 : 30;
    task.message = isCorrection
      ? 'Уточнение структуры JSON (1 корректирующий запрос)...'
      : mode === 'group'
        ? 'Прямое извлечение сцены, персонажей и связей (1 запрос по схеме GroupDNA V2)...'
        : 'Прямое извлечение карточки персонажа и сессии (1 запрос)...';
    onProgress?.({ ...task });

    const userPrompt = isCorrection
      ? buildTextDnaCorrectionPrompt(baseUserPrompt, lastRawDraft, lastErrors, mode)
      : baseUserPrompt;

    try {
      const rawResponse = await callJson({
        systemPrompt,
        userPrompt,
        maxTokens,
        temperature: TEXT_DNA_TEMPERATURE,
      });

      const parsedObject =
        typeof rawResponse === 'string'
          ? (() => {
              lastRawDraft = rawResponse;
              return JSON.parse(rawResponse);
            })()
          : rawResponse;

      if (parsedObject && typeof parsedObject === 'object') {
        lastRawDraft = JSON.stringify(parsedObject);
      }

      const { payload, errors } = validateAndNormalizeTextDnaPayload(
        parsedObject,
        mode,
        trimmed,
        attempt
      );

      if (payload && errors.length === 0) {
        const prepared = prepareTextDnaResult(payload, mysteryMode);
        task.stage = 'completed';
        task.progress = 100;
        task.message = 'Карточки и сцена успешно сформированы!';
        task.result = prepared;
        task.error = undefined;
        onProgress?.({ ...task });
        return prepared;
      }

      lastErrors = errors;
      task.rawDraft = lastRawDraft;
      task.validationErrors = errors;
    } catch (err) {
      const classified = classifyProviderError(err, task.stage);
      if (!classified.retryable || attempt >= TEXT_DNA_MAX_ATTEMPTS) {
        task.stage = 'error';
        task.error = classified;
        task.message = classified.message;
        onProgress?.({ ...task });
        throw classified;
      }
      lastErrors = [classified.message];
    }
  }

  const finalError = new TextDnaError(
    `Не удалось привести ответ модели к схеме TextDNA: ${lastErrors.join(' ')}`,
    {
      kind: 'schema',
      stage: 'correcting',
      retryable: true,
      rawResponse: lastRawDraft,
    }
  );
  task.stage = 'error';
  task.error = finalError;
  task.message = finalError.message;
  onProgress?.({ ...task });
  throw finalError;
}
