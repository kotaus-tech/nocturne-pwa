import React, { useState, useRef, useCallback } from 'react';
import {
  X,
  Sparkles,
  User,
  Users,
  Upload,
  FileText,
  Eye,
  EyeOff,
  ClipboardPaste,
  Trash2,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Lock,
} from 'lucide-react';
import {
  createTextDnaTask,
  extractTextDna,
  type TextDnaMode,
  type TextDnaResult,
  type TextDnaTask,
} from '../../services/textDna';

export interface TextDnaModalProps {
  open: boolean;
  onClose: () => void;
  onApply: (result: TextDnaResult, mysteryMode: boolean) => void;
  defaultMode?: TextDnaMode;
}

type ModalStep = 'mode' | 'input' | 'working' | 'preview';

export const TextDnaModal: React.FC<TextDnaModalProps> = ({
  open,
  onClose,
  onApply,
  defaultMode = 'group',
}) => {
  const [step, setStep] = useState<ModalStep>('mode');
  const [mode, setMode] = useState<TextDnaMode>(defaultMode);
  const [sourceText, setSourceText] = useState<string>('');
  const [isPromptHidden, setIsPromptHidden] = useState<boolean>(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState<boolean>(false);
  const [mysteryMode, setMysteryMode] = useState<boolean>(false);
  const [task, setTask] = useState<TextDnaTask | null>(null);
  const [result, setResult] = useState<TextDnaResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hiddenTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const charCount = sourceText.length;
  const lineCount = sourceText ? sourceText.split(/\r?\n/).length : 0;
  const approxTokens = sourceText ? Math.max(1, Math.ceil(charCount / 3.8)) : 0;

  const handleReset = useCallback(() => {
    setStep('mode');
    setSourceText('');
    setUploadedFileName(null);
    setTask(null);
    setResult(null);
    setErrorMsg(null);
    setIsDraggingFile(false);
  }, []);

  const readUploadedTextFile = useCallback(async (file: File) => {
    setErrorMsg(null);
    const isTextLike =
      file.type.startsWith('text/') ||
      /\.(txt|md|markdown|json|log|csv|prompt)$/i.test(file.name);

    if (!isTextLike) {
      setErrorMsg('Пожалуйста, выберите или перетащите текстовый файл (.txt, .md, .json).');
      return;
    }

    try {
      const content = await file.text();
      if (!content.trim()) {
        setErrorMsg(`Файл «${file.name}» пуст.`);
        return;
      }
      setSourceText(content);
      setUploadedFileName(file.name);
      setTask(null);
    } catch {
      setErrorMsg(`Не удалось прочитать текстовый файл «${file.name}».`);
    }
  }, []);

  const handleFileInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        await readUploadedTextFile(file);
      }
      if (e.target) {
        e.target.value = '';
      }
    },
    [readUploadedTextFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingFile(false);

      const file = e.dataTransfer.files?.[0];
      if (file) {
        await readUploadedTextFile(file);
        return;
      }

      const droppedText = e.dataTransfer.getData('text/plain');
      if (droppedText && droppedText.trim()) {
        setSourceText(droppedText);
        setUploadedFileName(null);
        setTask(null);
      }
    },
    [readUploadedTextFile]
  );

  const handlePasteFromClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setSourceText(text);
        setUploadedFileName(null);
        setTask(null);
        setErrorMsg(null);
      }
    } catch {
      hiddenTextareaRef.current?.focus();
    }
  }, []);

  const handleStartExtraction = useCallback(async () => {
    if (!sourceText.trim()) {
      setErrorMsg('Вставьте текст промпта или перетащите .txt файл.');
      return;
    }

    setErrorMsg(null);
    setStep('working');
    const activeTask =
      task && task.sourceText === sourceText && task.mode === mode
        ? task
        : createTextDnaTask(sourceText, mode, 'ru');
    setTask(activeTask);

    try {
      const extracted = await extractTextDna({
        text: sourceText,
        mode,
        preferredLanguage: 'ru',
        mysteryMode,
        task: activeTask,
        onProgress: (updated) => setTask({ ...updated }),
      });
      setResult(extracted);
      setStep('preview');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка при извлечении TextDNA';
      setErrorMsg(msg);
      setStep('input');
    }
  }, [sourceText, mode, mysteryMode, task]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-2xl rounded-2xl border border-white/10 bg-[#0d1017] text-slate-100 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Шапка модального окна */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-400">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">
                TextDNA — Прямой импорт без пресетов
              </h2>
              <p className="text-xs text-slate-400">
                Однозапросное преобразование больших промптов в карточки по схеме GroupDNA V2
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-white/5 hover:text-white transition"
            aria-label="Закрыть"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Тело модального окна */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {step === 'mode' && (
            <div className="space-y-4">
              <p className="text-sm text-slate-300">
                Выберите формат импорта. Весь ваш текст или <code className="text-indigo-300">.txt</code> файл будет обработан за один прямой запрос к API: длинные описания аккуратно сожмутся в ёмкие тезисы без отсебятины и с сохранением всех имён, секретов, правил и стартовых диалогов.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setMode('single');
                    setStep('input');
                  }}
                  className={`flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition ${
                    mode === 'single'
                      ? 'border-indigo-500/60 bg-indigo-500/10'
                      : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.05]'
                  }`}
                >
                  <div className="flex items-center gap-2 text-indigo-400 font-medium">
                    <User className="h-4 w-4" />
                    <span>Одиночный персонаж</span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Создаёт карточку одного персонажа, его секреты, лорбук и стартовую сессию.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMode('group');
                    setStep('input');
                  }}
                  className={`flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition ${
                    mode === 'group'
                      ? 'border-indigo-500/60 bg-indigo-500/10'
                      : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.05]'
                  }`}
                >
                  <div className="flex items-center gap-2 text-indigo-400 font-medium">
                    <Users className="h-4 w-4" />
                    <span>Групповая сцена (ансамбль)</span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Создаёт всех персонажей из промпта, граф отношений, асимметрию знаний и общую сцену.
                  </p>
                </button>
              </div>
            </div>
          )}

          {step === 'input' && (
            <div className="space-y-4">
              {/* Верхняя панель управления вводом: загрузка файла, буфер обмена, скрытие промпта */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.md,.markdown,.json,text/plain,text/markdown"
                    onChange={handleFileInputChange}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/10 transition"
                  >
                    <Upload className="h-3.5 w-3.5 text-indigo-400" />
                    <span>Загрузить .txt файл</span>
                  </button>

                  <button
                    type="button"
                    onClick={handlePasteFromClipboard}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/10 transition"
                  >
                    <ClipboardPaste className="h-3.5 w-3.5 text-indigo-400" />
                    <span>Вставить</span>
                  </button>

                  {sourceText.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setSourceText('');
                        setUploadedFileName(null);
                        setTask(null);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/20 bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-300 hover:bg-rose-500/20 transition"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Очистить</span>
                    </button>
                  )}
                </div>

                {/* Кнопка скрытия/маскировки содержимого промпта (защита от спойлеров) */}
                <button
                  type="button"
                  onClick={() => setIsPromptHidden((prev) => !prev)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                    isPromptHidden
                      ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                      : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                  }`}
                  title="Скрыть содержимое промпта, чтобы не читать спойлеры при вставке или перетаскивании файла"
                >
                  {isPromptHidden ? (
                    <>
                      <EyeOff className="h-3.5 w-3.5 text-amber-400" />
                      <span>Текст скрыт (показать)</span>
                    </>
                  ) : (
                    <>
                      <Eye className="h-3.5 w-3.5 text-slate-400" />
                      <span>Скрыть содержимое</span>
                    </>
                  )}
                </button>
              </div>

              {/* Зона ввода и Drag-and-Drop для .txt файлов */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`relative rounded-xl border transition ${
                  isDraggingFile
                    ? 'border-indigo-400 bg-indigo-500/15 ring-2 ring-indigo-500/30'
                    : 'border-white/10 bg-black/40'
                }`}
              >
                {isPromptHidden ? (
                  /* Скрытый режим: пользователь может вставлять, печатать или перетаскивать .txt без чтения текста */
                  <div
                    onClick={() => hiddenTextareaRef.current?.focus()}
                    className="relative flex flex-col items-center justify-center min-h-[240px] p-6 text-center cursor-text select-none"
                  >
                    <textarea
                      ref={hiddenTextareaRef}
                      value={sourceText}
                      onChange={(e) => {
                        setSourceText(e.target.value);
                        setUploadedFileName(null);
                        setTask(null);
                      }}
                      placeholder="Секретный режим ввода..."
                      aria-label="Скрытое поле ввода промпта"
                      className="absolute inset-0 w-full h-full opacity-0 cursor-text resize-none"
                    />

                    <div className="pointer-events-none flex flex-col items-center max-w-md space-y-3">
                      <div
                        className={`flex h-12 w-12 items-center justify-center rounded-2xl border ${
                          charCount > 0
                            ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400'
                            : 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                        }`}
                      >
                        {charCount > 0 ? (
                          <CheckCircle2 className="h-6 w-6" />
                        ) : (
                          <Lock className="h-6 w-6" />
                        )}
                      </div>

                      {charCount > 0 ? (
                        <>
                          <div className="space-y-1">
                            <p className="text-sm font-medium text-emerald-300">
                              Секретный промпт загружен и скрыт от чтения
                            </p>
                            <p className="text-xs text-slate-400">
                              Содержимое надёжно находится в поле ввода. Вы можете сразу запускать извлечение или заменить его новым текстом / файлом.
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                            {uploadedFileName && (
                              <span className="inline-flex items-center gap-1 rounded-md bg-indigo-500/20 px-2.5 py-1 text-xs text-indigo-300">
                                <FileText className="h-3.5 w-3.5" />
                                {uploadedFileName}
                              </span>
                            )}
                            <span className="rounded-md bg-white/10 px-2.5 py-1 text-xs text-slate-200">
                              {charCount.toLocaleString('ru-RU')} симв.
                            </span>
                            <span className="rounded-md bg-white/10 px-2.5 py-1 text-xs text-slate-200">
                              ~{approxTokens.toLocaleString('ru-RU')} токенов
                            </span>
                            <span className="rounded-md bg-white/10 px-2.5 py-1 text-xs text-slate-200">
                              {lineCount.toLocaleString('ru-RU')} стр.
                            </span>
                          </div>
                        </>
                      ) : (
                        <div className="space-y-1">
                          <p className="text-sm font-medium text-amber-200">
                            Режим скрытого промпта активен
                          </p>
                          <p className="text-xs text-slate-400">
                            Кликните сюда и нажмите <kbd className="rounded bg-white/10 px-1.5 py-0.5 text-[11px]">Ctrl+V</kbd>, перетащите <code className="text-indigo-300">.txt</code> файл в эту область или нажмите «Вставить» — текст загрузится, но останется невидимым.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="relative">
                    <textarea
                      value={sourceText}
                      onChange={(e) => {
                        setSourceText(e.target.value);
                        setUploadedFileName(null);
                        setTask(null);
                      }}
                      placeholder="Вставьте сюда готовый промпт любой длины (10k–50k+ токенов) или просто перетащите .txt файл в это окно..."
                      rows={10}
                      className="w-full rounded-xl bg-transparent p-4 text-sm text-slate-100 placeholder-slate-500 focus:outline-none resize-y min-h-[240px]"
                    />
                  </div>
                )}

                {isDraggingFile && (
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center rounded-xl bg-indigo-950/85 backdrop-blur-xs">
                    <Upload className="h-8 w-8 text-indigo-300 mb-2 animate-bounce" />
                    <p className="text-sm font-medium text-white">
                      Отпустите файл, чтобы загрузить промпт в TextDNA
                    </p>
                    <p className="text-xs text-indigo-300">
                      Поддерживаются .txt, .md и текстовые файлы
                    </p>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
                <div className="flex flex-wrap items-center gap-2">
                  {uploadedFileName && (
                    <span className="inline-flex items-center gap-1 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-indigo-300">
                      <FileText className="h-3 w-3" />
                      Файл: {uploadedFileName}
                    </span>
                  )}
                  <span>
                    Объём: <strong className="text-slate-200">{charCount.toLocaleString('ru-RU')}</strong> симв. (~
                    <strong className="text-slate-200">{approxTokens.toLocaleString('ru-RU')}</strong> токенов)
                  </span>
                  <span className="text-emerald-400">• 1 прямой запрос к API</span>
                </div>

                <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={mysteryMode}
                    onChange={(e) => setMysteryMode(e.target.checked)}
                    className="rounded border-white/20 bg-white/5 text-indigo-500 focus:ring-indigo-500"
                  />
                  <span className="text-slate-300">Режим тайны (скрыть секреты в UI)</span>
                </label>
              </div>

              {errorMsg && (
                <div className="flex items-start gap-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs text-rose-200">
                  <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-medium">Ошибка обработки</p>
                    <p className="text-rose-300/90">{errorMsg}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 'working' && (
            <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
              <Loader2 className="h-10 w-10 text-indigo-400 animate-spin" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-white">
                  {task?.message || 'Формируем карточки персонажей и сцену за 1 запрос...'}
                </p>
                <p className="text-xs text-slate-400">
                  Исходный материал ({charCount.toLocaleString('ru-RU')} симв.) уплотняется в структурированные тезисы без потери фактов
                </p>
              </div>
            </div>
          )}

          {step === 'preview' && result && (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-emerald-200">
                      Импорт TextDNA успешно завершён ({result.coverage.apiRequestsCount} запрос к API)
                    </p>
                    <p className="text-xs text-emerald-300/80">
                      Персонажей: {result.coverage.characterCount} • Записей лора:{' '}
                      {result.coverage.loreCount} • Правил и секретов:{' '}
                      {result.coverage.preservedRulesCount}
                    </p>
                  </div>
                </div>
              </div>

              {isPromptHidden || mysteryMode ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-200 flex items-center gap-2.5">
                  <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0" />
                  <span>
                    Подробности карточек и секреты скрыты от предпросмотра, чтобы сохранить интригу перед началом чата.
                  </span>
                </div>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {result.mode === 'single' ? (
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5 space-y-1">
                      <p className="text-sm font-semibold text-white">{result.character.name}</p>
                      <p className="text-xs text-indigo-300">{result.character.tagline}</p>
                      <p className="text-xs text-slate-400 line-clamp-3">
                        {result.character.description}
                      </p>
                    </div>
                  ) : (
                    result.characters.map((ch) => (
                      <div
                        key={ch.id}
                        className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5 space-y-1"
                      >
                        <p className="text-sm font-semibold text-white">{ch.name}</p>
                        <p className="text-xs text-indigo-300">{ch.tagline}</p>
                        <p className="text-xs text-slate-400 line-clamp-2">{ch.description}</p>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Подвал модального окна */}
        <div className="flex items-center justify-between border-t border-white/10 bg-black/30 px-6 py-4">
          {step === 'input' ? (
            <>
              <button
                type="button"
                onClick={() => setStep('mode')}
                className="rounded-lg px-3 py-2 text-xs font-medium text-slate-400 hover:text-white transition"
              >
                ← Сменить режим ({mode === 'group' ? 'Группа' : 'Одиночный'})
              </button>
              <button
                type="button"
                onClick={handleStartExtraction}
                disabled={!sourceText.trim()}
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-semibold text-white shadow-lg shadow-indigo-600/25 hover:bg-indigo-500 disabled:opacity-40 transition"
              >
                <Sparkles className="h-4 w-4" />
                <span>Преобразовать в карточки (1 запрос)</span>
              </button>
            </>
          ) : step === 'preview' && result ? (
            <>
              <button
                type="button"
                onClick={handleReset}
                className="rounded-lg px-3 py-2 text-xs font-medium text-slate-400 hover:text-white transition"
              >
                Загрузить другой текст
              </button>
              <button
                type="button"
                onClick={() => onApply(result, mysteryMode)}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-emerald-500 transition"
              >
                <CheckCircle2 className="h-4 w-4" />
                <span>Применить и создать</span>
              </button>
            </>
          ) : (
            <div className="ml-auto">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-4 py-2 text-xs text-slate-400 hover:text-white transition"
              >
                Отмена
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TextDnaModal;
