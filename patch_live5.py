import io

p = 'src/components/chat/DirectorPanel.tsx'
src = io.open(p, encoding='utf-8').read()

old = '  onTogglePresence?: (characterId: string, isPresent: boolean, reason?: string) => void;'
new = '''  onTogglePresence?: (characterId: string, isPresent: boolean, reason?: string) => void;
  /** «Живая сцена»: короткие реакции других героев в той же реплике. */
  onToggleLiveScene?: (enabled: boolean) => void;'''
assert src.count(old) == 1
src = src.replace(old, new, 1)

idx = src.index('\n  onTogglePresence,\n')
src = src[:idx] + '\n  onToggleLiveScene,' + src[idx + len('\n  onTogglePresence,'):]

anchor = '{participantCharacters.some((item) => !isPresent(item.id)) && ('
block = '''{participantCharacters.length > 1 && onToggleLiveScene && (
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
                      Отвечает по-прежнему один герой, но в конце реплики он может
                      дать 1–2 короткие реакции остальных — так сцена звучит живее.
                    </span>
                  </span>
                </label>
              )}

              '''
assert src.count(anchor) == 1
src = src.replace(anchor, block + anchor, 1)

io.open(p, 'w', encoding='utf-8').write(src)
print('DirectorPanel ok')

# ChatView
p = 'src/components/chat/ChatView.tsx'
src = io.open(p, encoding='utf-8').read()
old = '        onTogglePresence={handleTogglePresence}'
assert src.count(old) == 1, src.count(old)
src = src.replace(old, '''        onTogglePresence={handleTogglePresence}
        onToggleLiveScene={(enabled) => {
          void db.sessions.update(session.id, {
            liveScene: enabled,
            updatedAt: Date.now(),
          });
        }}''', 1)
io.open(p, 'w', encoding='utf-8').write(src)
print('ChatView ok')
