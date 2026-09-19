import io

p = 'src/services/promptBuilder.ts'
src = io.open(p, encoding='utf-8').read()

old = 'ным зрителем чужого разговора.`\n'
new = ('ным зрителем чужого разговора.` +\n'
       '        (liveScene\n'
       '          ? `\\n6. ЖИВАЯ СЦЕНА: если реплика задела кого-то ещё, ты можешь добавить в КОНЦЕ своего ответа 1–2 короткие реакции других присутствующих — каждую с новой строки, в формате «— **Имя:** реплика» (можно с одним коротким действием в *звёздочках*). Это единственное исключение из правила 1: реакции короткие, по одной-двум фразам, и только от тех, кто сейчас в сцене. Если реагировать некому или момент не тот — не добавляй никого.`\n'
       '          : "")\n')
assert src.count(old) == 1
src = src.replace(old, new, 1)

old = '  // 8. Групповая сцена: контекст остальных участников'
assert src.count(old) == 1
src = src.replace(old, '  const liveScene =\n    session.liveScene !== false && (group?.others?.length ?? 0) > 0;\n\n' + old, 1)

io.open(p, 'w', encoding='utf-8').write(src)
print('promptBuilder ok')
