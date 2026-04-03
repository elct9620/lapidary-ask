import { describe, it, expect } from "vitest";
import { buildFeedbackButtons } from "../src/discord/components";
import {
  FEEDBACK_PREFIX,
  buildFeedbackCustomId,
  parseFeedbackCustomId,
} from "../src/discord/feedback";
import { ComponentType, ButtonStyle } from "discord-api-types/v10";

describe("buildFeedbackButtons", () => {
  it("returns an action row with two secondary buttons", () => {
    const result = buildFeedbackButtons("trace-123", "user-456");

    expect(result).toHaveLength(1);
    const row = result[0]!;
    expect(row.type).toBe(ComponentType.ActionRow);
    expect(row.components).toHaveLength(2);

    const [thumbsUp, thumbsDown] = row.components;
    expect(thumbsUp!.type).toBe(ComponentType.Button);
    expect((thumbsUp as any).style).toBe(ButtonStyle.Secondary);
    expect((thumbsUp as any).label).toBe("👍 Helpful");
    expect((thumbsUp as any).custom_id).toBe("feedback:trace-123:user-456:up");

    expect(thumbsDown!.type).toBe(ComponentType.Button);
    expect((thumbsDown as any).style).toBe(ButtonStyle.Secondary);
    expect((thumbsDown as any).label).toBe("👎 Not helpful");
    expect((thumbsDown as any).custom_id).toBe(
      "feedback:trace-123:user-456:down",
    );
  });
});

describe("buildFeedbackCustomId", () => {
  it("produces a parseable custom_id (round-trip)", () => {
    const customId = buildFeedbackCustomId("trace-1", "user-2", "up");
    const parsed = parseFeedbackCustomId(customId);
    expect(parsed).toEqual({
      traceId: "trace-1",
      userId: "user-2",
      direction: "up",
    });
  });
});

describe("buildFeedbackCustomId truncation", () => {
  it("truncates traceId to keep custom_id within 100 characters", () => {
    const longTraceId = "a".repeat(200);
    const userId = "user-123";
    const customId = buildFeedbackCustomId(longTraceId, userId, "up");

    expect(customId.length).toBeLessThanOrEqual(100);
    expect(customId).toMatch(/^feedback:.+:user-123:up$/);
  });

  it("preserves traceId when custom_id is already within limit", () => {
    const traceId = "short-trace";
    const customId = buildFeedbackCustomId(traceId, "user-1", "down");

    expect(customId).toBe("feedback:short-trace:user-1:down");
  });

  it("round-trips correctly with truncated traceId", () => {
    const longTraceId = "b".repeat(200);
    const userId = "user-456";
    const customId = buildFeedbackCustomId(longTraceId, userId, "down");
    const parsed = parseFeedbackCustomId(customId);

    expect(parsed).not.toBeNull();
    expect(parsed!.userId).toBe(userId);
    expect(parsed!.direction).toBe("down");
    const fixedPartLength =
      FEEDBACK_PREFIX.length + 1 + 1 + userId.length + 1 + "down".length;
    expect(parsed!.traceId).toBe(
      longTraceId.slice(0, customId.length - fixedPartLength),
    );
  });
});

describe("parseFeedbackCustomId", () => {
  it("parses a valid 'up' custom_id", () => {
    const result = parseFeedbackCustomId("feedback:trace-1:user-2:up");
    expect(result).toEqual({
      traceId: "trace-1",
      userId: "user-2",
      direction: "up",
    });
  });

  it("parses a valid 'down' custom_id", () => {
    const result = parseFeedbackCustomId("feedback:trace-1:user-2:down");
    expect(result).toEqual({
      traceId: "trace-1",
      userId: "user-2",
      direction: "down",
    });
  });

  it("returns null for wrong prefix", () => {
    expect(parseFeedbackCustomId("other:trace-1:user-2:up")).toBeNull();
  });

  it("returns null for wrong number of parts", () => {
    expect(parseFeedbackCustomId("feedback:trace-1:up")).toBeNull();
  });

  it("returns null for invalid direction", () => {
    expect(parseFeedbackCustomId("feedback:trace-1:user-2:left")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseFeedbackCustomId("")).toBeNull();
  });
});
