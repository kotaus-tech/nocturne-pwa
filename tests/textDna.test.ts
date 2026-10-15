import { describe, it, expect, vi } from 'vitest';
import {
  extractTextDna,
  buildTextDnaSystemPrompt,
  TEXT_DNA_GROUP_MAX_TOKENS,
  TEXT_DNA_SINGLE_MAX_TOKENS,
} from '../src/services/textDna';

describe('TextDNA — прямой однозапросный пайплайн по принципу GroupDNA V2', () => {
  it('обрабатывает большой групповой промпт ровно за 1 вызов API без чанкинга и сохраняет все 8 категорий данных', async () => {
    const hugePrompt = Array.from(
      { length: 40 },
      (_, idx) =>
        `Блок ${idx + 1}: Детальное описание лора, правил сцены, персонажей Алисы («Северный Ветер») и Виктора («Ворон»), их тайных мотивов и стартового диалога.`
    ).join('\n\n');

    const mockRequestJson = vi.fn().mockResolvedValue({
      mode: 'group',
      scene: {
        title: 'Переговоры в Северной Башне',
        setting: 'Закрытый зал совета в цитадели',
        premise: 'Два представителя разных орденов вынуждены заключить перемирие',
        currentMoment: 'Оба входят в зал после полуночи',
        tone: 'Напряжённый политический триллер',
        firstMessage: '— Ты опоздал, Ворон, — тихо произнесла Алиса, не оборачиваясь от окна.',
        alternateGreetings: ['Виктор молча закрыл за собой тяжёлую дубовую дверь.'],
        authorRules: 'Не раскрывать истинного заказчика заговора до прямого допроса. Сохранять холодную вежливость.',
        lorebook: [
          {
            title: 'Пакт Пепла',
            content: 'Древний договор о ненападении внутри нейтральных башен.',
            keywords: ['Пакт Пепла', 'башня'],
          },
        ],
        preservedMaterial: 'Особое условие: при упоминании печати короля оба персонажа настораживаются.',
      },
      characters: [
        {
          name: 'Алиса Вейн',
          aliases: ['Северный Ветер', 'Леди Вейн'],
          tagline: 'Хранительница архива',
          age: '29',
          genre: 'Тёмное фэнтези',
          tags: ['дипломат', 'архивариус'],
          firstImpression: 'Высокая, в тёмно-синем плаще с серебряной пряжкой.',
          startingPoint: 'Стоит у стрельчатого окна зала совета.',
          summaryQuote: 'Слова стоят дороже золота, если знаешь, кому их продать.',
          description: 'Выпускница столичной академии, потерявшая семью во время осады.',
          personality: 'Сдержанная, расчётливая, говорит негромко и избегает прямых угроз.',
          scenario: 'Должна выяснить, кто передал Виктору ключи от верхнего яруса.',
          systemPrompt: 'Всегда обращается к Виктору по позывному «Ворон», пока они наедине.',
          secrets: 'Именно она спрятала подлинник королевского указа в подвале башни.',
          knowledgeBoundaries: 'Знает про засаду у моста, но НЕ знает, что Виктор ранен.',
          firstMessage: '',
          alternateGreetings: [],
          initialStats: { affection: 5, trust: -20, respect: 60, tension: 75 },
          lorebook: [],
          preservedMaterial: 'Носит кольцо-печатку с тайником.',
        },
        {
          name: 'Виктор Крей',
          aliases: ['Ворон', 'Капитан Крей'],
          tagline: 'Командир ночного дозора',
          age: '34',
          genre: 'Тёмное фэнтези',
          tags: ['командир', 'разведчик'],
          firstImpression: 'Шрам на левой скуле, дорожный плащ со следами дождя.',
          startingPoint: 'У входа в зал совета, скрывает ранение под плащом.',
          summaryQuote: 'Я пришёл за ответами, а не за прощением.',
          description: 'Бывший офицер пограничного гарнизона.',
          personality: 'Прямолинейный, недоверчивый, ценит дисциплину.',
          scenario: 'Скрыть своё ранение и проверить верность Алисы.',
          systemPrompt: 'Отвечает короткими рублеными фразами.',
          secrets: 'Ранен в плечо перед самым входом в цитадель.',
          knowledgeBoundaries: 'Подозревает архив в утечке, но НЕ знает, что указ у Алисы.',
          firstMessage: '',
          alternateGreetings: [],
          initialStats: { affection: 10, trust: -15, respect: 65, tension: 70 },
          lorebook: [],
          preservedMaterial: 'При себе запечатанный пакет от канцлера.',
        },
      ],
      relations: [
        {
          fromName: 'Алиса Вейн',
          toName: 'Виктор Крей',
          type: 'Бывшие союзники / соперники',
          description: 'Связывает общее прошлое на границе, но сейчас разделяет недоверие.',
          trust: -20,
          tension: 75,
          secretNote: 'Алиса всё ещё хранит его старый жетон.',
        },
      ],
      preservedMaterial: 'Глобальная заметка: время действия — третья стража после полуночи.',
    });

    const result = await extractTextDna({
      text: hugePrompt,
      mode: 'group',
      requestJsonFn: mockRequestJson,
    });

    expect(mockRequestJson).toHaveBeenCalledTimes(1);
    expect(mockRequestJson.mock.calls[0][0].maxTokens).toBe(TEXT_DNA_GROUP_MAX_TOKENS);
    expect(result.mode).toBe('group');
    if (result.mode === 'group') {
      expect(result.coverage.apiRequestsCount).toBe(1);
      expect(result.characters).toHaveLength(2);
      expect(result.characters[0].name).toBe('Алиса Вейн');
      expect(result.characters[0].description).toContain('Северный Ветер');
      expect(result.characters[0].systemPrompt).toContain('подлинник королевского указа');
      expect(result.characters[0].systemPrompt).toContain('НЕ знает, что Виктор ранен');
      expect(result.scene.firstMessage).toContain('Ты опоздал, Ворон');
      expect(result.relations).toHaveLength(1);
    }
  });

  it('выполняет ровно 1 корректирующий запрос, если первый ответ вернул неполную схему', async () => {
    const mockRequestJson = vi
      .fn()
      .mockResolvedValueOnce({
        mode: 'single',
        character: { name: '' },
      })
      .mockResolvedValueOnce({
        mode: 'single',
        character: {
          name: 'Элиас Морн',
          aliases: ['Доктор Морн'],
          tagline: 'Судебный алхимик',
          description: 'Специалист по редким ядам и манускриптам.',
          personality: 'Спокойный, педантичный.',
          systemPrompt: 'Не делает выводов без улик.',
          secrets: 'Ведёт тайный дневник экспериментов.',
          knowledgeBoundaries: 'Не знает имени заказчика.',
          firstMessage: 'Положите улики на стол и не трогайте колбы.',
        },
        session: {
          title: 'Лаборатория на окраине',
          scenario: 'Ночной визит к алхимику.',
          authorRules: 'Детективный темп без мистических допущений.',
        },
      });

    const result = await extractTextDna({
      text: 'Исходный текст про алхимика Элиаса Морна...',
      mode: 'single',
      requestJsonFn: mockRequestJson,
    });

    expect(mockRequestJson).toHaveBeenCalledTimes(2);
    expect(mockRequestJson.mock.calls[0][0].maxTokens).toBe(TEXT_DNA_SINGLE_MAX_TOKENS);
    expect(result.mode).toBe('single');
    if (result.mode === 'single') {
      expect(result.character.name).toBe('Элиас Морн');
      expect(result.character.description).toContain('Доктор Морн');
      expect(result.character.firstMessage).toContain('Положите улики на стол');
    }
  });

  it('формирует системный промпт без пресетов с запретом на додумывание и разрешением противоречий', () => {
    const sysPrompt = buildTextDnaSystemPrompt('group', 'ru');
    expect(sysPrompt).toContain('НИКАКИХ ПРЕСЕТОВ И ОТСЕБЯТИНЫ');
    expect(sysPrompt).toContain('НЕ РАЗРЕШАЙ ПРОТИВОРЕЧИЯ');
    expect(sysPrompt).toContain('ТЕЗИСНОЕ УПЛОТНЕНИЕ БЕЗ ПОТЕРИ СУТИ');
  });
});
