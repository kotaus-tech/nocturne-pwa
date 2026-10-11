import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { sanitizeSession } from "../src/db";
import { MysteryPlaceholder, MYSTERY_LABEL } from "../src/components/common/MysteryPlaceholder";
import { MessageBubble } from "../src/components/chat/MessageBubble";
import { StatusCard } from "../src/components/chat/StatsPanel";
import { StatsBadge } from "../src/components/chat/StatsBar";
import {
  canShowRelationshipToasts,
  mysteryModePatch,
} from "../src/services/mysteryMode";
import type { Character, Message, UserProfile } from "../src/types";

const SECRET = "СЕКРЕТНАЯ_МЫСЛЬ_42";

describe("режим тайны: флаг и правила уведомлений", () => {
  it("по умолчанию выключен", () => {
    expect(sanitizeSession({} as never).mysteryMode).toBe(false);
  });

  it("включение выключает уведомления отношений", () => {
    expect(mysteryModePatch(true)).toEqual({
      mysteryMode: true,
      showRelationshipToasts: false,
    });
  });

  it("выход из режима не включает уведомления обратно", () => {
    const patch = mysteryModePatch(false);
    expect(patch).toEqual({ mysteryMode: false });
    expect("showRelationshipToasts" in patch).toBe(false);
  });

  it("пока режим включён, уведомления не создаются, даже если флаг уведомлений включён", () => {
    expect(canShowRelationshipToasts({ mysteryMode: true, showRelationshipToasts: true })).toBe(false);
    expect(canShowRelationshipToasts({ mysteryMode: false, showRelationshipToasts: true })).toBe(true);
    expect(canShowRelationshipToasts({ mysteryMode: false, showRelationshipToasts: false })).toBe(false);
  });
});

describe("режим тайны: текст не попадает в разметку", () => {
  it("заглушка содержит только подпись и полоски", () => {
    const html = renderToStaticMarkup(createElement(MysteryPlaceholder, { lines: 3 }));
    expect(html).toContain(MYSTERY_LABEL);
    expect(html).not.toContain(SECRET);
  });

  it("сообщение в режиме тайны не выводит мысль ни в каком виде", () => {
    const character = { id: "c1", name: "Ива", avatarUrl: undefined } as unknown as Character;
    const userProfile = { name: "Я" } as unknown as UserProfile;
    const message = {
      id: "m1",
      sender: "assistant",
      content: "Обычная реплика",
      innerThought: SECRET,
      swipes: ["Обычная реплика"],
      currentSwipeIndex: 0,
      createdAt: 0,
      statsSnapshot: undefined,
    } as unknown as Message;

    const common = {
      message,
      character,
      userProfile,
      isLastAssistant: true,
      isLastUser: false,
      onRetry: () => {},
      onEdit: async () => {},
      onDelete: () => {},
      onSwipe: () => {},
      onRegenerate: () => {},
      onShowThought: () => {},
    };

    const hidden = renderToStaticMarkup(
      createElement(MessageBubble, { ...common, mysteryHidden: true })
    );
    expect(hidden).not.toContain(SECRET);
    expect(hidden).toContain("Мысль скрыта");

    const shown = renderToStaticMarkup(
      createElement(MessageBubble, { ...common, mysteryHidden: false })
    );
    expect(shown).toContain("Мысль");
    expect(shown).not.toContain("Мысль скрыта");
  });
});

describe("режим тайны: название статуса отношений", () => {
  const STATUS = "Осаждённая крепость";
  const stats = { trust: 40, affection: 50, closeness: 30, tension: 20, conflict: 10, statusTitle: STATUS } as never;

  it("карточка «Динамика вашей истории» не выводит статус в режиме тайны", () => {
    const html = renderToStaticMarkup(
      createElement(StatusCard, { statusTitle: STATUS, subtitle: "Отношения с Полина", mysteryHidden: true })
    );
    expect(html).not.toContain(STATUS);
    expect(html).toContain("Динамика вашей истории");
    expect(html).toContain("Отношения с Полина");
  });

  it("карточка без режима тайны показывает статус", () => {
    const html = renderToStaticMarkup(createElement(StatusCard, { statusTitle: STATUS }));
    expect(html).toContain(STATUS);
  });

  it("кнопка аналитики в шапке не выводит статус в режиме тайны", () => {
    const html = renderToStaticMarkup(
      createElement(StatsBadge, { stats, onClick: () => {}, mysteryHidden: true })
    );
    expect(html).not.toContain(STATUS);
    const shown = renderToStaticMarkup(createElement(StatsBadge, { stats, onClick: () => {} }));
    expect(shown).toContain(STATUS);
  });
});
