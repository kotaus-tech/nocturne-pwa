import { ChevronDown, Dices, Loader2, RefreshCw, Save, Wand2 } from "lucide-react";
import type { GroupGenerationResult, GroupRegenerationSection } from "../../services/groupGenerator/types";
import { ErrorBanner } from "./GroupGeneratorFeedback";

export function GroupGeneratorResult({
  result,
  error,
  saving,
  onRegenerate,
  onSave,
  onBack,
  onAnother,
}: {
  result: GroupGenerationResult;
  error: string | null;
  saving: boolean;
  onRegenerate: (section: GroupRegenerationSection, label: string, targetKey?: string) => void;
  onSave: () => void;
  onBack: () => void;
  onAnother: () => void;
}) {
  const names = new Map(result.blueprint.cast.map((item) => [item.key, item.name]));

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent" aria-hidden="true">
          <Wand2 size={21} />
        </div>
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-content">{result.blueprint.scene.title}</h3>
          <p className="mt-1 text-sm leading-relaxed text-content-secondary">{result.blueprint.scene.setting} · {result.blueprint.scene.tone}</p>
        </div>
      </div>

      <section className="rounded-2xl border border-accent/30 bg-accent/5 p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-accent">Общий опенинг</h4>
          <button type="button" onClick={() => onRegenerate("opening", "Перегенерируем опенинг")} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-accent/30 px-2.5 py-1.5 text-xs font-medium text-accent hover:bg-accent/10">
            <RefreshCw size={13} /> Другой опенинг
          </button>
        </div>
        <p className="text-sm leading-relaxed text-content">{result.blueprint.opening}</p>
        <p className="mt-3 text-xs leading-relaxed text-content-secondary">{result.blueprint.scene.hook}</p>
      </section>

      <section className="rounded-2xl border border-white/[0.07] bg-surface-2/50 p-4">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-content-muted">Что происходит</h4>
        <p className="text-sm leading-relaxed text-content">{result.blueprint.scene.premise}</p>
        <p className="mt-2 text-sm leading-relaxed text-content-secondary">{result.blueprint.scene.currentMoment}</p>
      </section>

      {(result.blueprint.scene.playerAnchor ||
        (result.blueprint.scene.locationConditions?.length ?? 0) > 0 ||
        (result.blueprint.scene.ensembleRoles?.length ?? 0) > 0) && (
        <section className="rounded-2xl border border-white/[0.07] bg-surface-2/40 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-content">Социальная рамка и физика места</h4>
            <button type="button" onClick={() => onRegenerate("anchoring", "Пересобираем позицию игрока")} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border-strong px-2.5 py-1.5 text-xs text-content-secondary hover:bg-surface-3 hover:text-content">
              <RefreshCw size={13} /> Другая позиция игрока
            </button>
          </div>
          {result.blueprint.scene.playerAnchor && (
            <div className="rounded-xl border border-accent/20 bg-accent/5 p-3 text-xs leading-relaxed">
              <p><b className="text-accent">Позиция:</b> {result.blueprint.scene.playerAnchor.mode}</p>
              <p className="mt-1"><b className="text-content-secondary">В сцене:</b> {result.blueprint.scene.playerAnchor.visibleRole}</p>
              {result.blueprint.scene.playerAnchor.playerKnowledge.length > 0 && (
                <p className="mt-1 text-content-secondary"><b>Игрок знает на старте:</b> {result.blueprint.scene.playerAnchor.playerKnowledge.join("; ")}</p>
              )}
              {result.blueprint.scene.playerAnchor.pressurePoints.length > 0 && (
                <p className="mt-1 text-content-muted"><b>Точки давления сцены:</b> {result.blueprint.scene.playerAnchor.pressurePoints.join("; ")}</p>
              )}
            </div>
          )}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {result.blueprint.scene.locationConditions && result.blueprint.scene.locationConditions.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-content-muted">Физические условия</p>
                <p className="mt-1 text-xs leading-relaxed text-content-secondary">{result.blueprint.scene.locationConditions.join("; ")}</p>
              </div>
            )}
            {result.blueprint.scene.ensembleRoles && result.blueprint.scene.ensembleRoles.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-content-muted">Доминанты ансамбля</p>
                <p className="mt-1 text-xs leading-relaxed text-content-secondary">{result.blueprint.scene.ensembleRoles.join("; ")}</p>
              </div>
            )}
          </div>
          {result.blueprint.scene.microCatalyst && (
            <p className="mt-3 text-xs leading-relaxed text-content-secondary"><b className="text-content">Микро-катализатор:</b> {result.blueprint.scene.microCatalyst}</p>
          )}
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-content">Герои ансамбля</h4>
          <button type="button" onClick={() => onRegenerate("cast", "Пересобираем героев")} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border-strong px-2.5 py-1.5 text-xs text-content-secondary hover:bg-surface-3 hover:text-content">
            <RefreshCw size={13} /> Другой состав
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {result.blueprint.cast.map((character) => (
            <article key={character.key} className="rounded-2xl border border-white/[0.07] bg-surface-2/50 p-3.5">
              <div className="flex items-start gap-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-xs font-bold text-accent">
                  {character.name.slice(0, 1)}
                </div>
                <div className="min-w-0 flex-1">
                  <h5 className="truncate text-sm font-semibold text-content">{character.name}</h5>
                  <p className="text-[11px] text-accent">{character.tagline} · {character.age}</p>
                </div>
                <button
                  type="button"
                  title={`Перегенерировать только ${character.name}`}
                  aria-label={`Перегенерировать только ${character.name}`}
                  onClick={() => onRegenerate("cast", `Перегенерируем только ${character.name}`, character.key)}
                  className="shrink-0 rounded-lg border border-border-strong p-2 text-content-muted hover:bg-surface-3 hover:text-content"
                >
                  <RefreshCw size={14} />
                </button>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-content-secondary">{character.personality}</p>
              <p className="mt-2 text-[11px] leading-relaxed text-content-muted"><b className="text-content-secondary">Роль:</b> {character.role}. <b className="text-content-secondary">Цель:</b> {character.wants[0]}</p>
              <p className="mt-2 text-[11px] leading-relaxed text-content-muted"><b className="text-content-secondary">Голос:</b> {character.speech.register}; {character.speech.rhythm}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-white/[0.07] bg-surface-2/40 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-semibold text-content">Связи внутри группы</h4>
            <p className="mt-1 text-[11px] text-content-muted">Направленные: отношение одного героя к другому может быть несимметричным.</p>
          </div>
          <button type="button" onClick={() => onRegenerate("relations", "Пересобираем связи")} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border-strong px-2.5 py-1.5 text-xs text-content-secondary hover:bg-surface-3 hover:text-content">
            <RefreshCw size={13} /> Другие связи
          </button>
        </div>
        <div className="space-y-2">
          {result.blueprint.relations.map((relation) => (
            <div key={`${relation.fromKey}-${relation.toKey}`} className="rounded-xl border border-white/[0.06] bg-[#0f131d]/70 p-3 text-xs leading-relaxed">
              <span className="font-semibold text-accent">{names.get(relation.fromKey) ?? relation.fromKey}</span>
              <span className="text-content-muted"> → </span>
              <span className="font-semibold text-content">{names.get(relation.toKey) ?? relation.toKey}</span>
              <span className="ml-1 text-content-secondary">· {relation.label}</span>
              <p className="mt-1 text-content-secondary">{relation.currentDynamic}</p>
            </div>
          ))}
        </div>
      </section>

      {(result.blueprint.informationLayers?.length ?? 0) > 0 && (
        <section className="rounded-2xl border border-warning/20 bg-warning/5 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-semibold text-content">Скрытая социальная сетка</h4>
              <p className="mt-1 text-[11px] text-content-muted">Пользователь видит карту, но NPC получают только свои разрешённые знания.</p>
            </div>
            <button type="button" onClick={() => onRegenerate("information", "Пересобираем скрытые связи")} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-warning/30 px-2.5 py-1.5 text-xs text-warning hover:bg-warning/10">
              <RefreshCw size={13} /> Другая сетка
            </button>
          </div>
          <div className="space-y-2">
            {result.blueprint.informationLayers?.map((layer, index) => (
              <div key={`${layer.type}-${index}`} className="rounded-xl border border-white/[0.07] bg-surface-2/50 p-3 text-xs leading-relaxed">
                <p className="font-semibold text-warning">{layer.type}</p>
                <p className="mt-1 text-content">{layer.content}</p>
                <p className="mt-1 text-content-secondary"><b>Знают:</b> {layer.holders.map((key) => key === "player" ? "игрок" : names.get(key) ?? key).join(", ")}</p>
                {layer.hiddenFrom.length > 0 && <p className="mt-1 text-content-muted"><b>Скрыто от:</b> {layer.hiddenFrom.map((key) => key === "player" ? "игрок" : names.get(key) ?? key).join(", ")}</p>}
                {layer.visibleClue && <p className="mt-1 text-content-secondary"><b>След:</b> {layer.visibleClue}</p>}
                {layer.revealCondition && <p className="mt-1 text-content-muted"><b>Раскрытие:</b> {layer.revealCondition}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {(result.blueprint.chemistry?.length ?? 0) > 0 && (
        <section className="rounded-2xl border border-accent/20 bg-accent/5 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-semibold text-content">Взрослый подтекст и химия</h4>
              <p className="mt-1 text-[11px] text-content-muted">Контекстная 18+ динамика: взаимность и границы остаются обязательными.</p>
            </div>
            <button type="button" onClick={() => onRegenerate("chemistry", "Пересобираем взрослую химию")} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-accent/30 px-2.5 py-1.5 text-xs text-accent hover:bg-accent/10">
              <RefreshCw size={13} /> Другая химия
            </button>
          </div>
          <div className="space-y-2">
            {result.blueprint.chemistry?.map((item, index) => (
              <div key={`${item.pattern}-${index}`} className="rounded-xl border border-white/[0.07] bg-surface-2/50 p-3 text-xs leading-relaxed">
                <p className="font-semibold text-accent">{item.pattern}</p>
                <p className="mt-1 text-content-secondary"><b>Участники:</b> {item.participants.map((key) => key === "player" ? "игрок" : names.get(key) ?? key).join(", ")}</p>
                {item.intensity && <p className="mt-1 text-content-secondary"><b>Интенсивность:</b> {item.intensity}</p>}
                {item.publicMask && <p className="mt-1 text-content-secondary"><b>Снаружи:</b> {item.publicMask}</p>}
                {item.trigger && <p className="mt-1 text-content-secondary"><b>Триггер:</b> {item.trigger}</p>}
                {item.boundaries.length > 0 && <p className="mt-1 text-content-muted"><b>Границы:</b> {item.boundaries.join("; ")}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {error && <ErrorBanner message={error} />}

      <div className="space-y-3 border-t border-border pt-5">
        <button type="button" onClick={onSave} disabled={saving} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-base font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-50">
          {saving ? <Loader2 size={19} className="animate-spin" /> : <Save size={19} />}
          {saving ? "Создаём ветку…" : "Создать групповую ветку"}
        </button>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onAnother} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-border-strong bg-surface-2 px-3 py-2.5 text-sm font-medium text-content-secondary hover:bg-surface-3">
            <Dices size={17} /> Другой ансамбль
          </button>
          <button type="button" onClick={onBack} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-content-muted hover:bg-surface-2">
            <ChevronDown size={16} className="rotate-90" /> К настройкам
          </button>
        </div>
      </div>
    </div>
  );
}
