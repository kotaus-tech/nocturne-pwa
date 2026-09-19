import io

# ── 1. Флаг ветки ─────────────────────────────────────────────────────────
p = 'src/types.ts'
src = io.open(p, encoding='utf-8').read()
old = '''  /** Своя личность для этой ветки; не задана — берётся персона персонажа или активная. */'''
new = '''  /**
   * «Живая сцена»: другие герои могут коротко отреагировать в той же реплике.
   * По умолчанию включено, выключается тумблером в панели режиссёра.
   */
  liveScene?: boolean;
  /** Своя личность для этой ветки; не задана — берётся персона персонажа или активная. */'''
assert src.count(old) == 1
src = src.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8').write(src)
print('types ok')

p = 'src/db.ts'
src = io.open(p, encoding='utf-8').read()
old = '    relations: sanitizeSceneRelations(raw?.relations),'
new = '    relations: sanitizeSceneRelations(raw?.relations),\n    liveScene: raw?.liveScene !== false,'
assert src.count(old) == 1
src = src.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8').write(src)
print('db ok')

# ── 2. Промпт: правило живой сцены ────────────────────────────────────────
p = 'src/services/promptBuilder.ts'
src = io.open(p, encoding='utf-8').read()

old = '''        `5. ПРАВИЛО ТРЕУГОЛЬНИКА (анти-вытеснение игрока): между персонажами кипит своё — спор, подколки, взгляды, старые обиды. Но ${userProfile.name} всегда якорь сцены: обращайся к нему за мнением, лови его реакцию, апеллируй к нему как к свидетелю или судье спора. ${userProfile.name} не должен оставаться пассивным зрителем чужого разговора.`'''
new = '''        `5. ПРАВИЛО ТРЕУГОЛЬНИКА (анти-вытеснение игрока): между персонажами кипит своё — спор, подколки, взгляды, старые обиды. Но ${userProfile.name} всегда якорь сцены: обращайся к нему за мнением, лови его реакцию, апеллируй к нему как к свидетелю или судье спора. ${userProfile.name} не должен оставаться пассивным зрителем чужого разговора.` +
        (liveScene
          ? `\\n6. ЖИВАЯ СЦЕНА: если реплика задела кого-то ещё, ты можешь добавить в КОНЦЕ своего ответа 1–2 короткие реакции других присутствующих — каждую с новой строки, в формате «— **Имя:** реплика» (можно с одним коротким действием в *звёздочках*). Это единственное исключение из правила 1: реакции короткие, по одной-двум фразам, и только у тех, кто сейчас в сцене. Если реагировать некому или момент не тот — не добавляй никого.`
          : "")'''
assert src.count(old) == 1
src = src.replace(old, new, 1)

# флаг читаем из ветки
old = '''  // 8. Групповая сцена: контекст остальных участников'''
assert src.count(old) == 1
src = src.replace(old, '''  const liveScene =
    session.liveScene !== false && (group?.others?.length ?? 0) > 0;

''' + old, 1)
io.open(p, 'w', encoding='utf-8').write(src)
print('promptBuilder ok')

# ── 3. Панель режиссёра: тумблер ──────────────────────────────────────────
p = 'src/components/chat/DirectorPanel.tsx'
src = io.open(p, encoding='utf-8').read()

old = '  onTogglePresence?: (characterId: string, isPresent: boolean, reason?: string) => void;'
new = '''  onTogglePresence?: (characterId: string, isPresent: boolean, reason?: string) => void;
  /** «Живая сцена»: короткие реакции других героев в той же реплике. */
  onToggleLiveScene?: (enabled: boolean) => void;'''
assert src.count(old) == 1
src = src.replace(old, new, 1)

old = '''  onTogglePresence,
'''
if src.count(old) == 1:
    src = src.replace(old, '  onTogglePresence,\n  onToggleLiveScene,\n', 1)
else:
    # найдём в деструктуризации пропсов
    idx = src.index('onTogglePresence,')
    src = src[:idx] + 'onTogglePresence,\n  onToggleLiveScene,\n' + src[idx + len('onTogglePresence,\n'):]

old = '''                {participantCharacters.some((item) => !isPresent(item.id)) && ('''
new = '''                {participantCharacters.length > 1 && onToggleLiveScene && (
                  <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-2xl border border-white/[0.08] bg-[#121622]/70 p-2.5">
                    <input
                      type="checkbox"
                      checked={session.liveScene !== false}
                      onChange={(event) => onToggleLiveScene(event.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
                    />
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold text-content">
                        Живая сцена
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-relaxed text-content-muted">
                        Отвечает по-прежнему один герой, но в конце реплики он
                        может дать 1–2 короткие реакции остальных — так сцена
                        звучит живее.
                      </span>
                    </span>
                  </label>
                )}

                {participantCharacters.some((item) => !isPresent(item.id)) && ('''
assert src.count(old) == 1
src = src.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8').write(src)
print('DirectorPanel ok')
