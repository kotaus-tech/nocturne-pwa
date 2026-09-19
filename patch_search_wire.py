import io

p = 'src/App.tsx'
src = io.open(p, encoding='utf-8').read()

# 1. Импорт модалки
old = 'import { PersonaSwitcher } from "./components/common/PersonaSwitcher";'
new = 'import { PersonaSwitcher } from "./components/common/PersonaSwitcher";\nimport { GlobalSearchModal } from "./components/common/GlobalSearchModal";'
assert src.count(old) == 1
src = src.replace(old, new, 1)

# 2. Состояние
old = '  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);'
new = '  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);\n  const [searchOpen, setSearchOpen] = useState(false);'
assert src.count(old) == 1
src = src.replace(old, new, 1)

# 3. Горячая клавиша ⌘K / Ctrl+K
old = '  const handleNavigate = (nextTab: TabKey) => {'
assert src.count(old) == 1
new = '''  // ⌘K / Ctrl+K открывает поиск по всему миру из любого раздела.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const handleNavigate = (nextTab: TabKey) => {'''
src = src.replace(old, new, 1)

# 4. Кнопка в шапке открывает поиск, а не библиотеку
old = '''              <button
                type="button"
                onClick={() => handleNavigate("characters")}
                className="hidden sm:flex items-center gap-2 rounded-xl border border-white/[0.08] bg-surface-2 px-3 py-1.5 text-xs text-content-muted transition-colors hover:border-white/[0.15] hover:text-content"
              >'''
new = '''              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="hidden sm:flex items-center gap-2 rounded-xl border border-white/[0.08] bg-surface-2 px-3 py-1.5 text-xs text-content-muted transition-colors hover:border-white/[0.15] hover:text-content"
              >'''
assert src.count(old) == 1
src = src.replace(old, new, 1)

io.open(p, 'w', encoding='utf-8').write(src)
print('App part 1 ok')
