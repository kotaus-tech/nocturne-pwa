import {
  Dices,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  XCircle,
} from "lucide-react";
import { renderRoleplayText } from "../../utils/textRenderer";
import {
  parseFateTag,
  type FateOutcome,
} from "../../services/dice";
import type {
  Character,
  Message,
  UserProfile,
} from "../../types";
import { cn } from "../../utils/cn";

interface NovelReaderProps {
  messages: Message[];
  character: Character;
  userProfile: UserProfile;
}

function NovelFateLabel({
  outcome,
  label,
}: {
  outcome: FateOutcome;
  label: string;
}) {
  const appearances = {
    triumph: {
      icon: Sparkles,
      color: "text-success",
    },
    success: {
      icon: CheckCircle2,
      color: "text-info",
    },
    twist: {
      icon: AlertCircle,
      color: "text-warning",
    },
    fail: {
      icon: XCircle,
      color: "text-danger",
    },
  };

  const appearance = appearances[outcome] || appearances.success;
  const Icon = appearance.icon;

  return (
    <div
      className={cn(
        "mb-3 flex items-start gap-2 font-sans text-xs font-medium leading-relaxed",
        appearance.color
      )}
    >
      <Dices
        size={15}
        aria-hidden="true"
        className="mt-0.5 shrink-0"
      />

      <span className="min-w-0 [overflow-wrap:anywhere]">
        {label}
      </span>

      <Icon
        size={15}
        aria-hidden="true"
        className="mt-0.5 shrink-0"
      />
    </div>
  );
}

export function NovelReader({
  messages,
  character,
  userProfile,
}: NovelReaderProps) {
  return (
    <article
      aria-label="История в режиме книги"
      className="mx-auto w-full max-w-3xl px-3 py-4 sm:px-5 sm:py-6"
    >
      <div className="rounded-[20px] bg-surface px-5 py-6 sm:px-8 sm:py-8 lg:px-10">
        {messages.length === 0 ? (
          <p className="py-6 text-base leading-relaxed text-content-secondary">
            В этой истории пока нет сообщений.
          </p>
        ) : (
          <div className="mx-auto max-w-[62ch] space-y-6 sm:space-y-7">
            {messages.map((message) => {
              const rawText =
                message.swipes[message.currentSwipeIndex] ?? "";

              const fateInfo = parseFateTag(rawText);
              const displayText = fateInfo
                ? fateInfo.cleanText
                : rawText;

              const isUser = message.sender === "user";
              const senderName = isUser
                ? userProfile.name
                : character.name;

              const isOOC =
                displayText.startsWith("[OOC:") ||
                displayText.startsWith("[Вне роли:");

              return (
                <section
                  key={message.id}
                  id={`novel-msg-${message.id}`}
                  aria-label={`Сообщение: ${senderName}`}
                  className="min-w-0"
                >
                  {fateInfo && (
                    <NovelFateLabel
                      outcome={fateInfo.outcome}
                      label={fateInfo.label}
                    />
                  )}

                  {isOOC && (
                    <p className="mb-2 text-xs font-medium text-warning">
                      Вне роли · OOC
                    </p>
                  )}

                  <p className="novel-font whitespace-pre-wrap text-lg leading-[1.85] text-content [overflow-wrap:anywhere]">
                    <span
                      className={cn(
                        "mr-2 font-semibold",
                        isUser
                          ? "text-[var(--relationship-affection)]"
                          : "text-accent"
                      )}
                    >
                      {senderName}:
                    </span>
                    {renderRoleplayText(displayText)}
                  </p>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </article>
  );
}