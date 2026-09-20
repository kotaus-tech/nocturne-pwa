import { useMemo } from "react";
import {
  BookOpen,
  MessageSquareQuote,
  Quote,
  ScrollText,
  Sparkles,
  Tags,
  User,
  Wand2,
} from "lucide-react";
import type { Character } from "../../types";
import { Avatar } from "../common/Avatar";
import { Badge } from "../common/Badge";
import { renderRoleplayText } from "../../utils/textRenderer";
import { cn } from "../../utils/cn";

/**
 * Лист импортированного персонажа — то, как карточка ляжет в базу.
 *
 * Показывается отдельной вкладкой в окне импорта: игрок видит не сплошной
 * текст, а привычную карточку по полям, и сразу замечает, чего не хватает.
 */

interface SectionProps {
  label: string;
  value?: string;
  icon: typeof User;
  /** Ролевой текст: действия в звёздочках и реплики через тире. */
  roleplay?: boolean;
  className?: string;
}

function SectionCard({ label, value, icon: Icon, roleplay = false, className }: SectionProps) {
  const filled = Boolean(value?.trim());

  return (
    <section
      className={cn(
        "min-w-0 rounded-2xl border p-4",
        filled
          ? "border-white/[0.07] bg-[#121620]/90"
          : "border-dashed border-white/[0.09] bg-surface-2/30",
        className
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <Icon size={13} className={filled ? "text-accent" : "text-content-muted"} />
          <h4 className="truncate text-[11px] font-semibold uppercase tracking-wider text-content-muted">
            {label}
          </h4>
        </div>

        {filled && (
          <span className="shrink-0 text-[10px] tabular-nums text-content-muted">
            {(value ?? "").length}
          </span>
        )}
      </div>

      {filled ? (
        <div className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-content-secondary">
          {roleplay ? renderRoleplayText(value ?? "") : value}
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-content-muted">
          — не заполнено —
        </p>
      )}
    </section>
  );
}

export function ImportedCardSheet({ character }: { character: Character }) {
  const tags = useMemo(
    () => (character.tags ?? []).filter((tag) => tag.trim().length > 0),
    [character.tags]
  );

  const greetings = useMemo(
    () =>
      (character.alternateGreetings ?? []).filter((text) => text.trim().length > 0),
    [character.alternateGreetings]
  );

  const book = character.lorebook ?? [];

  const filledCount = useMemo(() => {
    let filled = 0;

    if (character.description?.trim()) filled += 1;
    if (character.personality?.trim()) filled += 1;
    if (character.scenario?.trim()) filled += 1;
    if (character.systemPrompt?.trim()) filled += 1;
    if (character.firstMessage?.trim()) filled += 1;
    if (character.tagline?.trim()) filled += 1;
    if (book.length > 0) filled += 1;
    if (greetings.length > 0) filled += 1;

    return filled;
  }, [character, book.length, greetings.length]);

  const totalCount = 8;

  return (
    <div className="space-y-4">
      {/* Шапка карточки */}
      <header className="flex items-start gap-4 rounded-2xl border border-white/[0.08] bg-gradient-to-br from-[#161b26] to-[#121620] p-4">
        <Avatar
          src={character.avatarUrl}
          name={character.name}
          size={72}
          className="shrink-0 ring-1 ring-white/10"
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-bold text-zinc-100">
              {character.name}
            </h3>
            {character.genre?.trim() && <Badge size="sm">{character.genre}</Badge>}
          </div>

          {character.originTag?.trim() && (
            <p className="mt-0.5 text-[11px] text-content-muted">
              {character.originTag}
            </p>
          )}

          {character.tagline?.trim() && (
            <p className="mt-2 text-xs leading-relaxed text-accent">
              {character.tagline}
            </p>
          )}

          {tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-lg border border-white/[0.07] bg-surface-2/70 px-2 py-0.5 text-[11px] text-content-secondary"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/[0.06] pt-2.5 text-[11px] text-content-muted">
            <span>
              заполнено полей:{" "}
              <span className="tabular-nums text-content-secondary">
                {filledCount} из {totalCount}
              </span>
            </span>
            <span className="flex items-center gap-1">
              <BookOpen size={12} />
              <span className="tabular-nums">{book.length}</span> записей мира
            </span>
            <span className="flex items-center gap-1">
              <MessageSquareQuote size={12} />
              <span className="tabular-nums">{greetings.length}</span> доп. приветствий
            </span>
          </div>
        </div>
      </header>

      {/* Основные поля */}
      <div className="grid gap-3 sm:grid-cols-2">
        <SectionCard
          label="Внешность и описание"
          value={character.description}
          icon={User}
        />
        <SectionCard
          label="Характер"
          value={character.personality}
          icon={Sparkles}
        />
        <SectionCard
          label="Сценарий и завязка"
          value={character.scenario}
          icon={ScrollText}
          className="sm:col-span-2"
        />
        <SectionCard
          label="Системные правила"
          value={character.systemPrompt}
          icon={Wand2}
          className="sm:col-span-2"
        />
      </div>

      {/* Первое сообщение — как оно появится в чате */}
      <section className="rounded-2xl border border-accent/25 bg-accent/[0.06] p-4">
        <div className="flex items-center gap-1.5">
          <Quote size={13} className="text-accent" />
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-accent">
            Первое сообщение
          </h4>
        </div>

        {character.firstMessage?.trim() ? (
          <div className="rp-text mt-2 text-sm leading-relaxed text-zinc-100">
            {renderRoleplayText(character.firstMessage)}
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-content-muted">— не заполнено —</p>
        )}
      </section>

      {/* Альтернативные приветствия */}
      {greetings.length > 0 && (
        <section className="rounded-2xl border border-white/[0.07] bg-[#121620]/90 p-4">
          <div className="flex items-center gap-1.5">
            <MessageSquareQuote size={13} className="text-accent" />
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-content-muted">
              Альтернативные приветствия ({greetings.length})
            </h4>
          </div>

          <ul className="mt-2.5 space-y-2">
            {greetings.map((text, index) => (
              <li
                key={text}
                className="rounded-xl border border-white/[0.06] bg-surface-2/60 p-3"
              >
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-content-muted">
                  Вариант {index + 1} — станет свайпом первого сообщения
                </span>
                <div className="rp-text text-xs leading-relaxed text-content-secondary">
                  {renderRoleplayText(text)}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Лорбук */}
      <section className="rounded-2xl border border-white/[0.07] bg-[#121620]/90 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <BookOpen size={13} className="text-accent" />
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-content-muted">
              Мир и знания ({book.length})
            </h4>
          </div>

          {book.length > 0 && (
            <span className="text-[10px] text-content-muted">
              активируются по ключам в репликах
            </span>
          )}
        </div>

        {book.length === 0 ? (
          <p className="mt-2 text-[11px] text-content-muted">— не заполнено —</p>
        ) : (
          <ul className="mt-2.5 space-y-2">
            {book.map((entry) => (
              <li
                key={entry.id}
                className="rounded-xl border border-white/[0.06] bg-surface-2/60 p-3"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <Tags size={12} className="shrink-0 text-content-muted" />
                  {entry.keys.map((key) => (
                    <span
                      key={key}
                      className="rounded-md bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent"
                    >
                      {key}
                    </span>
                  ))}
                  {!entry.isActive && (
                    <span className="text-[10px] text-content-muted">· выключено</span>
                  )}
                </div>

                <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-content-secondary">
                  {entry.content}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
