import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Cpu,
  DatabaseBackup,
  DownloadCloud,
  UploadCloud,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Loader2,
  AlertCircle,
  Check,
  Save,
  Server,
  Sliders,
  Radio,
  Bookmark,
  BookmarkPlus,
  X,
  Search,
  ChevronDown,
  Layers,
  RotateCcw,
} from "lucide-react";
import {
  getApiConfig,
  setApiConfig,
  getApiPresets,
  saveApiPreset,
  deleteApiPreset,
  exportBackup,
  importBackup,
  wipeAllData,
  type BackupBundle,
} from "../../db";
import type {
  ApiConfig,
  ApiPreset,
  ThinkingMode,
} from "../../types";
import { fetchAvailableModels, isLocalEndpoint } from "../../services/apiClient";
import { cn } from "../../utils/cn";

interface SettingsPageProps {
  initialTab?: "api" | "backup";
}

const TEMPLATE_PRESETS: {
  label: string;
  baseUrl: string;
  mode: ApiConfig["mode"];
}[] = [
  {
    label: "Ollama (локально)",
    baseUrl: "http://localhost:11434",
    mode: "openai",
  },
  {
    label: "LM Studio (локально)",
    baseUrl: "http://localhost:1234/v1",
    mode: "openai",
  },
  {
    label: "OpenRouter",
    baseUrl: "[https://openrouter.ai/api/v1](https://openrouter.ai/api/v1)",
    mode: "openai",
  },
  {
    label: "DeepSeek",
    baseUrl: "[https://api.deepseek.com](https://api.deepseek.com)",
    mode: "openai",
  },
  {
    label: "Google Gemini",
    baseUrl: "",
    mode: "gemini",
  },
];

const THINKING_OPTIONS: {
  value: ThinkingMode;
  label: string;
  desc: string;
}[] = [
  {
    value: "OFF",
    label: "Мгновенный — без размышлений",
    desc: "Запрашивает отключение размышлений.",
  },
  {
    value: "LOW",
    label: "Быстрый (LOW)",
    desc: "Минимальный анализ ситуации и быстрый ответ.",
  },
  {
    value: "MEDIUM",
    label: "Баланс (MEDIUM)",
    desc: "Взвешенный сюжет и эмоции.",
  },
  {
    value: "HIGH",
    label: "Глубокий (HIGH)",
    desc: "Высокий уровень размышлений для анализа контекста.",
  },
  {
    value: "AUTO",
    label: "Авто — по умолчанию",
    desc: "Стандартное поведение провайдера без переопределения.",
  },
];

const CTX_OPTIONS = [2048, 4096, 8192, 16384, 32768, 65536, 131072];

const FIELD_LABEL =
  "mb-2 block text-xs font-semibold uppercase tracking-wider text-content-secondary";

function SearchableModelSelect({
  models,
  value,
  onChange,
  placeholder = "Выберите модель...",
}: {
  models: string[];
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent | TouchEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("touchstart", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [isOpen]);

  const allModels = useMemo(() => {
    if (value && !models.includes(value)) {
      return [value, ...models];
    }
    return models;
  }, [models, value]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allModels;
    return allModels.filter((m) => m.toLowerCase().includes(q));
  }, [allModels, search]);

  return (
    <div className="relative w-full" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="input-field flex w-full items-center justify-between gap-2 text-left text-sm font-mono transition-colors hover:border-accent/40"
      >
        <span className="truncate text-zinc-100">
          {value || placeholder}
        </span>
        <ChevronDown
          size={16}
          className={cn(
            "shrink-0 text-content-muted transition-transform duration-200",
            isOpen && "rotate-180 text-accent"
          )}
        />
      </button>

      {isOpen && (
        <div className="absolute left-0 right-0 z-50 mt-1.5 flex max-h-80 flex-col overflow-hidden rounded-2xl border border-white/[0.12] bg-[#141824] shadow-2xl backdrop-blur-2xl">
          <div className="relative border-b border-white/[0.08] p-2.5">
            <Search
              size={15}
              className="absolute left-5 top-1/2 -translate-y-1/2 text-content-muted"
            />
            <input
              type="text"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск модели (например, claude, flash, qwen)..."
              className="w-full rounded-xl border border-white/[0.08] bg-black/50 py-2 pl-9 pr-8 text-xs text-zinc-100 placeholder:text-content-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-content-muted hover:text-zinc-200"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="flex items-center justify-between border-b border-white/[0.04] bg-white/[0.02] px-3.5 py-1.5 text-[10px] text-content-muted">
            <span>
              Найдено: {filtered.length} из {allModels.length}
            </span>
            {value && (
              <span className="truncate max-w-[180px]">
                Текущая: {value}
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-1.5 overscroll-contain">
            {filtered.length > 0 ? (
              filtered.map((m) => {
                const isSelected = m === value;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      onChange(m);
                      setIsOpen(false);
                      setSearch("");
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-xs font-mono transition-all",
                      isSelected
                        ? "bg-accent/20 text-accent font-semibold"
                        : "text-zinc-300 hover:bg-white/[0.06] hover:text-zinc-100"
                    )}
                  >
                    <span className="truncate">{m}</span>
                    {isSelected && <Check size={14} className="shrink-0 text-accent" />}
                  </button>
                );
              })
            ) : (
              <div className="py-6 text-center text-xs text-content-muted">
                Ничего не найдено по запросу «{search}»
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function SettingsPage({ initialTab = "api" }: SettingsPageProps) {
  const [activeTab, setActiveTab] = useState<"api" | "backup">(initialTab);

  const [api, setApi] = useState<ApiConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [presets, setPresets] = useState<ApiPreset[]>([]);
  const [presetInputOpen, setPresetInputOpen] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");
  const [presetToast, setPresetToast] = useState<string | null>(null);

  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const [backupBusy, setBackupBusy] = useState<"export" | "import" | "wipe" | null>(null);
  const [backupStatus, setBackupStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const id = useId();
  const mountedRef = useRef(false);
  const apiRevisionRef = useRef(0);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    let active = true;

    Promise.all([getApiConfig(), getApiPresets()])
      .then(([loadedApi, loadedPresets]) => {
        if (!active) return;
        setApi(loadedApi);
        setPresets(loadedPresets);
      })
      .catch((cause) => {
        if (!active) return;
        setLoadError(
          cause instanceof Error ? cause.message : "Не удалось прочитать настройки."
        );
      });

    return () => {
      active = false;
      mountedRef.current = false;
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const triggerPresetToast = (msg: string) => {
    setPresetToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      if (mountedRef.current) setPresetToast(null);
    }, 2500);
  };

  const updateApi = (patch: Partial<ApiConfig>, resetModelList = false) => {
    apiRevisionRef.current += 1;
    setSaved(false);
    setSaveError(null);
    setApi((curr) => (curr ? { ...curr, ...patch } : curr));

    if (resetModelList) {
      setAvailableModels([]);
      setModelError(null);
    }
  };

  const resetSamplingDefaults = () => {
    updateApi({
      temperature: 0.9,
      maxTokens: 4096,
      topP: 0.9,
      topK: 40,
      presencePenalty: 0.0,
      frequencyPenalty: 0.0,
    });
    triggerPresetToast("Параметры сброшены на рекомендованные!");
  };

  const isLocal = isLocalEndpoint(api?.baseUrl);

  const handleCreatePreset = async () => {
    if (!api || !newPresetName.trim()) return;
    try {
      const created = await saveApiPreset(newPresetName.trim(), api);
      setPresets((prev) => [created, ...prev]);
      setNewPresetName("");
      setPresetInputOpen(false);
      triggerPresetToast(`Пресет «${created.name}» сохранён!`);
    } catch {
      triggerPresetToast("Ошибка сохранения пресета.");
    }
  };

  const handleLoadPreset = (preset: ApiPreset) => {
    updateApi({ ...preset.config }, true);
    triggerPresetToast(`Загружен пресет: «${preset.name}»`);
  };

  const handleDeletePreset = async (presetId: string, name: string) => {
    if (!confirm(`Удалить пресет «${name}»?`)) return;
    try {
      await deleteApiPreset(presetId);
      setPresets((prev) => prev.filter((p) => p.id !== presetId));
      triggerPresetToast("Пресет удалён.");
    } catch {
      triggerPresetToast("Ошибка при удалении.");
    }
  };

  const handleFetchModels = async () => {
    if (!api || loadingModels) return;
    const requestApi = api;
    const rev = apiRevisionRef.current;

    setLoadingModels(true);
    setModelError(null);

    try {
      const list = await fetchAvailableModels(requestApi);
      if (!mountedRef.current || rev !== apiRevisionRef.current) return;

      if (list.length === 0) {
        setModelError("Список моделей пуст. Убедитесь в корректности URL и ключа.");
      } else {
        setAvailableModels(list);
        if (!requestApi.model && list[0]) {
          updateApi({ model: list[0] });
        }
      }
    } catch (cause) {
      if (mountedRef.current && rev === apiRevisionRef.current) {
        setModelError(
          cause instanceof Error ? cause.message : "Не удалось загрузить список моделей."
        );
      }
    } finally {
      if (mountedRef.current) setLoadingModels(false);
    }
  };

  const saveApi = async () => {
    if (!api || saving) return;
    setSaving(true);
    setSaved(false);
    setSaveError(null);

    try {
      await setApiConfig(api);
      if (mountedRef.current) {
        setSaved(true);
        savedTimerRef.current = setTimeout(() => {
          if (mountedRef.current) setSaved(false);
        }, 2000);
      }
    } catch (cause) {
      if (mountedRef.current) {
        setSaveError(
          cause instanceof Error ? cause.message : "Не удалось сохранить настройки API."
        );
      }
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  };

  const handleExport = async () => {
    if (backupBusy) return;
    setBackupBusy("export");
    setBackupStatus(null);
    let objectUrl: string | null = null;

    try {
      const bundle = await exportBackup();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], {
        type: "application/json",
      });
      objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `nocturne-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();

      setBackupStatus({
        type: "success",
        text: "Файл резервной копии подготовлен и загружен.",
      });
    } catch (cause) {
      setBackupStatus({
        type: "error",
        text: cause instanceof Error ? cause.message : "Ошибка при экспорте бэкапа.",
      });
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setBackupBusy(null);
    }
  };

  const handleImport = async (file: File) => {
    if (backupBusy) return;
    setBackupBusy("import");
    setBackupStatus(null);
    let reloadScheduled = false;

    try {
      const text = await file.text();
      const bundle = JSON.parse(text) as BackupBundle;
      if (!bundle || typeof bundle !== "object") {
        throw new Error("Файл не является корректным JSON-документом.");
      }

      const confirmed = confirm(
        "Импорт полностью перезапишет текущих персонажей, ветки чатов и настройки. Продолжить?"
      );
      if (!confirmed) {
        setBackupBusy(null);
        return;
      }

      await importBackup(bundle);
      setBackupStatus({
        type: "success",
        text: "Данные успешно восстановлены. Перезагрузка приложения…",
      });

      reloadScheduled = true;
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (cause) {
      setBackupStatus({
        type: "error",
        text: cause instanceof Error ? cause.message : "Не удалось прочитать файл бэкапа.",
      });
    } finally {
      if (!reloadScheduled) setBackupBusy(null);
    }
  };

  const handleWipe = async () => {
    if (backupBusy) return;
    const confirmed = confirm(
      "Точно удалить ВСЕ локальные данные приложения без возможности восстановления?"
    );
    if (!confirmed) return;

    setBackupBusy("wipe");
    try {
      await wipeAllData();
      window.location.reload();
    } catch (cause) {
      setBackupStatus({
        type: "error",
        text: cause instanceof Error ? cause.message : "Не удалось удалить данные.",
      });
      setBackupBusy(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 md:px-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-content-muted">
          Конфигурация системы
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-100 sm:text-3xl">
          Настройки приложения
        </h1>
        <p className="mt-1 text-sm text-content-secondary">
          Управление подключениями к нейросетям, пресетами и бэкапами.
        </p>
      </header>

      <div className="mb-6 flex gap-2 rounded-2xl border border-white/[0.08] bg-[#121620]/90 p-1.5 backdrop-blur-xl">
        <button
          type="button"
          onClick={() => setActiveTab("api")}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition-all",
            activeTab === "api"
              ? "bg-accent/15 text-accent shadow-sm"
              : "text-content-muted hover:bg-white/[0.04] hover:text-content"
          )}
        >
          <Cpu size={16} />
          <span>Модель и API</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("backup")}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition-all",
            activeTab === "backup"
              ? "bg-accent/15 text-accent shadow-sm"
              : "text-content-muted hover:bg-white/[0.04] hover:text-content"
          )}
        >
          <DatabaseBackup size={16} />
          <span>Резервные копии (Бэкап)</span>
        </button>
      </div>

      {loadError && (
        <div
          role="alert"
          className="mb-6 flex items-start gap-3 rounded-2xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger"
        >
          <AlertCircle size={18} className="shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      {activeTab === "api" && (
        <>
          {!api ? (
            <div className="flex items-center gap-2 py-10 text-sm text-content-secondary">
              <Loader2 size={18} className="animate-spin text-accent" />
              <span>Загрузка параметров подключения…</span>
            </div>
          ) : (
            <div className="space-y-6">
              {/* СЕКЦИЯ: ПРЕСЕТЫ ПОДКЛЮЧЕНИЙ */}
              <section className="rounded-3xl border border-white/[0.07] bg-[#121620]/90 p-6 backdrop-blur-xl">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Bookmark size={18} className="text-accent" />
                    <h2 className="text-base font-bold text-zinc-100">
                      Сохранённые пресеты подключений
                    </h2>
                  </div>

                  {!presetInputOpen ? (
                    <button
                      type="button"
                      onClick={() => setPresetInputOpen(true)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-accent/40 bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent transition-all hover:bg-accent/25 active:scale-95"
                    >
                      <BookmarkPlus size={14} />
                      <span>Сохранить текущие как пресет</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPresetInputOpen(false)}
                      className="inline-flex items-center gap-1 text-xs text-content-muted hover:text-content"
                    >
                      <X size={14} />
                      <span>Отмена</span>
                    </button>
                  )}
                </div>

                {presetInputOpen && (
                  <div className="mb-4 flex flex-col gap-2 rounded-2xl border border-accent/30 bg-accent/5 p-3 sm:flex-row">
                    <input
                      type="text"
                      className="input-field text-xs flex-1"
                      value={newPresetName}
                      autoFocus
                      onChange={(e) => setNewPresetName(e.target.value)}
                      placeholder="Название пресета (например: Ollama Qwen 3.5 или OpenRouter Claude)"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleCreatePreset();
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => void handleCreatePreset()}
                      disabled={!newPresetName.trim()}
                      className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-40"
                    >
                      <Check size={14} />
                      <span>Сохранить пресет</span>
                    </button>
                  </div>
                )}

                {presets.length > 0 ? (
                  <div className="mb-5 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                    {presets.map((p) => {
                      const isPresetLocal = isLocalEndpoint(p.config.baseUrl);
                      return (
                        <div
                          key={p.id}
                          className="group relative flex items-center justify-between gap-2 rounded-2xl border border-white/[0.08] bg-surface-2 p-3 transition-all hover:border-accent/40 hover:bg-surface-3"
                        >
                          <button
                            type="button"
                            onClick={() => handleLoadPreset(p)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <p className="truncate text-xs font-bold text-zinc-200 group-hover:text-accent">
                              {p.name}
                            </p>
                            <p className="mt-0.5 truncate text-[11px] text-content-muted">
                              {p.config.model || (isPresetLocal ? "Локальная модель" : "Модель не выбрана")} · {p.config.mode === "gemini" ? "Gemini" : isPresetLocal ? "Ollama" : "OpenAI API"}
                            </p>
                          </button>

                          <button
                            type="button"
                            onClick={() => void handleDeletePreset(p.id, p.name)}
                            title="Удалить пресет"
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-content-muted transition-colors hover:bg-danger/10 hover:text-danger"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mb-4 text-xs text-content-muted">
                    У вас пока нет сохранённых пресетов. Настройте подключение ниже и сохраните его в один клик.
                  </p>
                )}

                <div className="border-t border-white/[0.06] pt-3.5">
                  <span className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-content-muted">
                    Быстрые шаблоны провайдеров
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {TEMPLATE_PRESETS.map((preset) => (
                      <button
                        type="button"
                        key={preset.label}
                        onClick={() => {
                          const isPresetLocal = isLocalEndpoint(preset.baseUrl);
                          updateApi(
                            {
                              mode: preset.mode,
                              baseUrl: preset.baseUrl,
                              apiKey: isPresetLocal ? "" : api.apiKey,
                            },
                            true
                          );
                        }}
                        className={cn(
                          "rounded-xl border px-3 py-1.5 text-xs font-medium transition-all active:scale-95",
                          api.baseUrl === preset.baseUrl
                            ? "border-accent bg-accent/15 text-accent font-semibold"
                            : "border-white/[0.08] bg-surface-2 text-content-secondary hover:border-accent/40 hover:text-accent"
                        )}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                {presetToast && (
                  <div className="mt-3 flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-xs font-semibold text-accent animate-in fade-in duration-200">
                    <CheckCircle2 size={15} />
                    <span>{presetToast}</span>
                  </div>
                )}
              </section>

              {/* ОСНОВНАЯ СЕКЦИЯ НАСТРОЙКИ ПОДКЛЮЧЕНИЯ */}
              <section className="rounded-3xl border border-white/[0.07] bg-[#121620]/90 p-6 backdrop-blur-xl">
                <div className="mb-6 flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-bold text-zinc-100">
                      Параметры активного подключения
                    </h2>
                    <p className="mt-0.5 text-xs text-content-muted">
                      Настройте ключи, адрес сервера и генерацию
                    </p>
                  </div>

                  {isLocal && (
                    <span className="flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-3 py-1 text-xs font-semibold text-success">
                      <Server size={13} />
                      <span>Локальный сервер</span>
                    </span>
                  )}
                </div>

                <div className="space-y-5">
                  {isLocal && (
                    <div className="rounded-2xl border border-white/[0.08] bg-[#141824] p-3.5 text-xs leading-relaxed text-zinc-300 space-y-1.5">
                      <div className="flex items-center gap-2 font-semibold text-accent">
                        <Server size={15} />
                        <span>Подключение к Ollama без ключа</span>
                      </div>
                      <p>
                        Для Ollama ключ авторизации не требуется. Если при загрузке моделей возникает ошибка сети, запустите Ollama в терминале с разрешением CORS:
                      </p>
                      <pre className="rounded-xl bg-black/50 p-2 font-mono text-[11px] text-zinc-200 overflow-x-auto">
                        OLLAMA_ORIGINS="*" ollama serve
                      </pre>
                    </div>
                  )}

                  <div>
                    <label className={FIELD_LABEL}>Формат протокола</label>
                    <div className="grid grid-cols-2 gap-3">
                      {(
                        [
                          ["openai", "OpenAI / Ollama / LM Studio"],
                          ["gemini", "Google Gemini API"],
                        ] as const
                      ).map(([mode, label]) => {
                        const selected = api.mode === mode;
                        return (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => updateApi({ mode }, true)}
                            className={cn(
                              "flex items-center justify-center gap-2 rounded-xl border p-3 text-xs font-semibold transition-all",
                              selected
                                ? "border-accent/50 bg-accent/15 text-accent"
                                : "border-white/[0.07] bg-surface-2 text-content-secondary hover:bg-surface-3"
                            )}
                          >
                            {selected && <Check size={14} />}
                            <span>{label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {api.mode === "openai" && (
                    <div>
                      <label htmlFor={`${id}-base-url`} className={FIELD_LABEL}>
                        Base URL
                      </label>
                      <input
                        id={`${id}-base-url`}
                        className="input-field text-sm font-mono"
                        value={api.baseUrl}
                        autoCapitalize="none"
                        spellCheck={false}
                        onChange={(e) => updateApi({ baseUrl: e.target.value }, true)}
                        placeholder="http://localhost:11434"
                      />
                    </div>
                  )}

                  <div>
                    <label htmlFor={`${id}-api-key`} className={FIELD_LABEL}>
                      {isLocal ? "API-ключ (не требуется для Ollama)" : "API-ключ"}
                    </label>
                    <input
                      id={`${id}-api-key`}
                      type="password"
                      className={cn(
                        "input-field text-sm font-mono",
                        isLocal && "opacity-60 focus:opacity-100"
                      )}
                      value={api.apiKey}
                      autoCapitalize="none"
                      spellCheck={false}
                      onChange={(e) => updateApi({ apiKey: e.target.value }, true)}
                      placeholder={isLocal ? "Не требуется для локальной модели" : "sk-..."}
                    />
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <label className={FIELD_LABEL}>
                        Модель
                      </label>
                      <button
                        type="button"
                        onClick={() => void handleFetchModels()}
                        disabled={loadingModels}
                        className="flex items-center gap-1.5 text-xs font-semibold text-accent hover:underline disabled:opacity-50"
                      >
                        {loadingModels ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <RefreshCw size={13} />
                        )}
                        <span>{isLocal ? "Загрузить модели из Ollama" : "Загрузить список"}</span>
                      </button>
                    </div>

                    {availableModels.length > 0 ? (
                      <SearchableModelSelect
                        models={availableModels}
                        value={api.model}
                        onChange={(model) => updateApi({ model })}
                        placeholder="Нажмите для поиска и выбора модели..."
                      />
                    ) : (
                      <input
                        id={`${id}-model`}
                        className="input-field text-sm font-mono"
                        value={api.model}
                        spellCheck={false}
                        onChange={(e) => updateApi({ model: e.target.value })}
                        placeholder={
                          isLocal
                            ? "llama3:latest"
                            : api.mode === "gemini"
                              ? "gemini-2.0-flash"
                              : "openai/gpt-4o-mini"
                        }
                      />
                    )}

                    {modelError && (
                      <p className="mt-2 whitespace-pre-wrap text-xs text-danger leading-relaxed">
                        {modelError}
                      </p>
                    )}
                  </div>

                  {/* Универсальный переключатель стриминга для любого API */}
                  <div className="flex items-center justify-between rounded-2xl border border-white/[0.08] bg-surface-2 p-3.5">
                    <div>
                      <p className="text-xs font-bold text-zinc-100 flex items-center gap-2">
                        <Radio size={14} className={api.streamEnabled !== false ? "text-accent animate-pulse" : "text-content-muted"} />
                        <span>Стриминг ответов в реальном времени</span>
                      </p>
                      <p className="mt-0.5 text-[11px] text-content-muted">
                        Текст реплики печатается токен за токеном по мере генерации
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        updateApi({
                          streamEnabled: api.streamEnabled === false,
                          localStreamEnabled: api.streamEnabled === false,
                        })
                      }
                      className={cn(
                        "rounded-xl border px-3.5 py-1.5 text-xs font-semibold transition-all",
                        api.streamEnabled !== false
                          ? "border-accent bg-accent/20 text-accent shadow-sm"
                          : "border-white/[0.08] bg-[#121622] text-content-muted"
                      )}
                    >
                      {api.streamEnabled !== false ? "Включен" : "Выключен"}
                    </button>
                  </div>

                  {/* Переключатель ступенчатого окна контекста для экономии KV-кэширования */}
                  <div className="flex items-center justify-between rounded-2xl border border-white/[0.08] bg-surface-2 p-3.5">
                    <div className="pr-3">
                      <p className="text-xs font-bold text-zinc-100 flex items-center gap-2">
                        <Layers size={14} className={api.steppedContextEnabled !== false ? "text-accent" : "text-content-muted"} />
                        <span>Ступенчатое окно контекста (Кэширование)</span>
                      </p>
                      <p className="mt-0.5 text-[11px] text-content-muted leading-relaxed">
                        Фиксирует начало истории шагами по 10 сообщений. Позволяет Ru-OpenRouter, DeepSeek и локальным моделям кэшировать префикс диалога и экономить до 80% токенов. При выключении используется плавное скользящее окно со сдвигом на каждом шаге.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        updateApi({
                          steppedContextEnabled: api.steppedContextEnabled === false,
                        })
                      }
                      className={cn(
                        "shrink-0 rounded-xl border px-3.5 py-1.5 text-xs font-semibold transition-all",
                        api.steppedContextEnabled !== false
                          ? "border-accent bg-accent/20 text-accent shadow-sm"
                          : "border-white/[0.08] bg-[#121622] text-content-muted"
                      )}
                    >
                      {api.steppedContextEnabled !== false ? "Включено" : "Выключено"}
                    </button>
                  </div>

                  {/* Блок Thinking Mode */}
                  {(api.mode === "gemini" || isLocal) && (
                    <div className="border-t border-white/[0.07] pt-4">
                      <div className="mb-1 flex items-center justify-between">
                        <label htmlFor={`${id}-thinking`} className={FIELD_LABEL}>
                          Режим размышлений (Thinking Mode)
                        </label>
                        {isLocal && (
                          <span className="text-[11px] font-medium text-accent">
                            Для Qwen 2.5/3.5 и DeepSeek R1
                          </span>
                        )}
                      </div>
                      <select
                        id={`${id}-thinking`}
                        className="input-field text-sm"
                        value={api.thinkingMode || "AUTO"}
                        onChange={(e) =>
                          updateApi({ thinkingMode: e.target.value as ThinkingMode })
                        }
                      >
                        {THINKING_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      {isLocal && (
                        <p className="mt-1 text-[11px] text-content-muted">
                          «Мгновенный — без размышлений» отключает фазу &lt;think&gt;, экономя контекст и давая быстрый ответ.
                        </p>
                      )}
                    </div>
                  )}

                  {/* Секция базового контекста */}
                  <div className="border-t border-white/[0.07] pt-4">
                    <div className="flex items-center justify-between text-xs">
                      <span className={FIELD_LABEL}>История в промпте (Размер окна диалога)</span>
                      <span className="font-semibold text-accent tabular-nums">
                        {api.contextWindow} сообщ.
                      </span>
                    </div>
                    <input
                      type="range"
                      min={6}
                      max={80}
                      step={2}
                      value={api.contextWindow}
                      onChange={(e) =>
                        updateApi({ contextWindow: Number(e.target.value) })
                      }
                      className="block h-10 w-full accent-accent"
                    />
                  </div>
                </div>
              </section>

              {/* УНИВЕРСАЛЬНЫЙ БЛОК: ТОНКАЯ НАСТРОЙКА ГЕНЕРАЦИИ (СЭМПЛИНГ) */}
              <section className="rounded-3xl border border-accent/25 bg-[#141828]/90 p-6 backdrop-blur-xl shadow-xl">
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/20 text-accent">
                      <Sliders size={18} />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-zinc-100">
                        Параметры сэмплинга генерации
                      </h3>
                      <p className="text-[11px] text-content-muted">
                        Универсальное управление поведением моделей (Ru-OpenRouter, DeepSeek, Gemini, Ollama)
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={resetSamplingDefaults}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-surface-2 px-3 py-1.5 text-xs font-semibold text-content-secondary hover:bg-surface-3 hover:text-accent"
                  >
                    <RotateCcw size={13} />
                    <span>Сбросить на рекомендуемые</span>
                  </button>
                </div>

                <div className="space-y-5">
                  <div className="grid gap-5 sm:grid-cols-2">
                    {/* Температура */}
                    <div>
                      <div className="flex items-center justify-between text-xs">
                        <span className={FIELD_LABEL}>Температура (Креативность)</span>
                        <span className="font-bold text-accent tabular-nums">
                          {api.temperature}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0.1}
                        max={1.5}
                        step={0.05}
                        value={api.temperature}
                        onChange={(e) => updateApi({ temperature: Number(e.target.value) })}
                        className="block h-8 w-full accent-accent"
                      />
                      <p className="mt-1 text-[10px] text-content-muted">
                        Низкая — строгий текст, высокая — более свободная и образная речь.
                      </p>
                    </div>

                    {/* Максимальное число токенов ответа */}
                    <div>
                      <div className="flex items-center justify-between text-xs">
                        <span className={FIELD_LABEL}>Лимит длины ответа (Max Tokens)</span>
                        <span className="font-bold text-accent tabular-nums">
                          {(api.maxTokens ?? 4096).toLocaleString()} ток.
                        </span>
                      </div>
                      <input
                        type="range"
                        min={256}
                        max={8192}
                        step={128}
                        value={api.maxTokens ?? 4096}
                        onChange={(e) => updateApi({ maxTokens: Number(e.target.value) })}
                        className="block h-8 w-full accent-accent"
                      />
                      <p className="mt-1 text-[10px] text-content-muted">
                        Максимальный объём одной генерируемой реплики персонажа.
                      </p>
                    </div>

                    {/* Top-P */}
                    <div>
                      <div className="flex items-center justify-between text-xs">
                        <span className={FIELD_LABEL}>Top-P (Вероятностный срез)</span>
                        <span className="font-bold text-accent tabular-nums">
                          {api.topP ?? 0.9}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0.1}
                        max={1.0}
                        step={0.05}
                        value={api.topP ?? 0.9}
                        onChange={(e) => updateApi({ topP: Number(e.target.value) })}
                        className="block h-8 w-full accent-accent"
                      />
                      <p className="mt-1 text-[10px] text-content-muted">
                        Ограничивает пул кандидатов кумулятивной вероятностью.
                      </p>
                    </div>

                    {/* Top-K */}
                    <div>
                      <div className="flex items-center justify-between text-xs">
                        <span className={FIELD_LABEL}>Top-K (Число лучших токенов)</span>
                        <span className="font-bold text-accent tabular-nums">
                          {api.topK ?? 40}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={100}
                        step={1}
                        value={api.topK ?? 40}
                        onChange={(e) => updateApi({ topK: Number(e.target.value) })}
                        className="block h-8 w-full accent-accent"
                      />
                      <p className="mt-1 text-[10px] text-content-muted">
                        Размер выборки наиболее вероятных следующих слов.
                      </p>
                    </div>

                    {/* Frequency Penalty / Штраф за повторы */}
                    <div>
                      <div className="flex items-center justify-between text-xs">
                        <span className={FIELD_LABEL}>Штраф за повторы (Frequency Penalty)</span>
                        <span className="font-bold text-accent tabular-nums">
                          {api.frequencyPenalty ?? 0.0}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0.0}
                        max={1.5}
                        step={0.05}
                        value={api.frequencyPenalty ?? 0.0}
                        onChange={(e) => updateApi({ frequencyPenalty: Number(e.target.value) })}
                        className="block h-8 w-full accent-accent"
                      />
                      <p className="mt-1 text-[10px] text-content-muted">
                        Штрафует модель за повторное использование одних и тех же фраз.
                      </p>
                    </div>

                    {/* Presence Penalty / Разнообразие тем */}
                    <div>
                      <div className="flex items-center justify-between text-xs">
                        <span className={FIELD_LABEL}>Штраф за застревание (Presence Penalty)</span>
                        <span className="font-bold text-accent tabular-nums">
                          {api.presencePenalty ?? 0.0}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0.0}
                        max={1.5}
                        step={0.05}
                        value={api.presencePenalty ?? 0.0}
                        onChange={(e) => updateApi({ presencePenalty: Number(e.target.value) })}
                        className="block h-8 w-full accent-accent"
                      />
                      <p className="mt-1 text-[10px] text-content-muted">
                        Поощряет модель развивать новые сюжетные ветки и темы.
                      </p>
                    </div>
                  </div>

                  {/* Специальный контекстный буфер для Ollama */}
                  {isLocal && (
                    <div className="border-t border-white/[0.08] pt-4">
                      <div className="flex items-center justify-between text-xs">
                        <span className={FIELD_LABEL}>
                          Аппаратный контекст видеопамяти Ollama (num_ctx)
                        </span>
                        <span className="font-bold text-accent tabular-nums">
                          {(api.localNumCtx ?? 16384).toLocaleString()} токенов
                        </span>
                      </div>

                      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7 pt-1">
                        {CTX_OPTIONS.map((val) => {
                          const current = api.localNumCtx ?? 16384;
                          const selected = current === val;
                          return (
                            <button
                              key={val}
                              type="button"
                              onClick={() => updateApi({ localNumCtx: val })}
                              className={cn(
                                "rounded-xl border py-1.5 text-center text-xs font-medium transition-all",
                                selected
                                  ? "border-accent bg-accent/20 text-accent font-bold shadow-sm"
                                  : "border-white/[0.07] bg-surface-2 text-content-muted hover:text-content hover:bg-surface-3"
                              )}
                            >
                              {val >= 1024 ? `${val / 1024}k` : val}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </section>

              {saveError && (
                <div className="flex items-start gap-3 rounded-2xl border border-danger/30 bg-danger/5 p-4 text-xs text-danger">
                  <AlertCircle size={16} className="shrink-0" />
                  <span>{saveError}</span>
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <span className="text-xs text-content-muted">
                  {saved ? "✓ Настройки сохранены." : "Изменения применяются сразу."}
                </span>

                <button
                  type="button"
                  onClick={() => void saveApi()}
                  disabled={saving}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-6 py-2.5 text-sm font-semibold text-on-accent shadow-[0_0_20px_rgba(139,92,246,0.25)] hover:bg-accent-hover active:bg-accent-pressed disabled:opacity-50"
                >
                  {saving ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : saved ? (
                    <Check size={16} />
                  ) : (
                    <Save size={16} />
                  )}
                  <span>Сохранить настройки</span>
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === "backup" && (
        <div className="space-y-6">
          <section className="rounded-3xl border border-white/[0.07] bg-[#121620]/90 p-6 backdrop-blur-xl">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent">
                <DatabaseBackup size={24} />
              </div>
              <div>
                <h2 className="text-base font-bold text-zinc-100">
                  Автономное хранилище IndexedDB
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-content-secondary">
                  Все миры, реплики, персоны и параметры хранятся локально в вашем браузере.
                </p>
              </div>
            </div>
          </section>

          <div className="grid gap-4 sm:grid-cols-2">
            <section className="flex flex-col justify-between rounded-3xl border border-white/[0.07] bg-[#121620]/90 p-6 backdrop-blur-xl">
              <div>
                <DownloadCloud size={28} className="text-accent" />
                <h3 className="mt-4 text-base font-bold text-zinc-100">Экспорт данных</h3>
                <p className="mt-1 text-xs leading-relaxed text-content-secondary">
                  Сохраняет полную базу данных в один защищенный JSON-файл.
                </p>
              </div>
              <button
                type="button"
                disabled={backupBusy !== null}
                onClick={() => void handleExport()}
                className="mt-6 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-xs font-semibold text-on-accent shadow-[0_0_20px_rgba(139,92,246,0.25)] hover:bg-accent-hover disabled:opacity-50"
              >
                {backupBusy === "export" ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <DownloadCloud size={16} />
                )}
                <span>Скачать бэкап (.json)</span>
              </button>
            </section>

            <section className="flex flex-col justify-between rounded-3xl border border-white/[0.07] bg-[#121620]/90 p-6 backdrop-blur-xl">
              <div>
                <UploadCloud size={28} className="text-content-secondary" />
                <h3 className="mt-4 text-base font-bold text-zinc-100">Восстановление</h3>
                <p className="mt-1 text-xs leading-relaxed text-content-secondary">
                  Загрузите ранее экспортированный JSON.
                </p>
              </div>
              <button
                type="button"
                disabled={backupBusy !== null}
                onClick={() => fileRef.current?.click()}
                className="mt-6 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-surface-2 px-4 py-2.5 text-xs font-semibold text-zinc-200 hover:bg-surface-3 disabled:opacity-50"
              >
                {backupBusy === "import" ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <UploadCloud size={16} />
                )}
                <span>Выбрать файл бэкапа</span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.currentTarget.files?.[0];
                  if (f) void handleImport(f);
                  e.currentTarget.value = "";
                }}
              />
            </section>
          </div>

          {backupStatus && (
            <div
              className={cn(
                "flex items-center gap-3 rounded-2xl border p-4 text-xs",
                backupStatus.type === "success"
                  ? "border-success/30 bg-success/5 text-success"
                  : "border-danger/30 bg-danger/5 text-danger"
              )}
            >
              {backupStatus.type === "success" ? (
                <CheckCircle2 size={18} className="shrink-0" />
              ) : (
                <XCircle size={18} className="shrink-0" />
              )}
              <span>{backupStatus.text}</span>
            </div>
          )}

          <section className="rounded-3xl border border-danger/25 bg-danger/5 p-6 backdrop-blur-xl">
            <div className="flex items-start gap-4">
              <AlertTriangle size={24} className="shrink-0 text-danger" />
              <div className="flex-1">
                <h3 className="text-sm font-bold text-danger">Опасная зона</h3>
                <p className="mt-1 text-xs text-content-secondary">
                  Полная очистка базы данных сотрёт всех персонажей и истории без возможности отката.
                </p>
                <button
                  type="button"
                  disabled={backupBusy !== null}
                  onClick={() => void handleWipe()}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl border border-danger/40 bg-danger/10 px-4 py-2 text-xs font-semibold text-danger hover:bg-danger/20 disabled:opacity-50"
                >
                  <Trash2 size={14} />
                  <span>Стереть все локальные данные</span>
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}