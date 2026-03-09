import { describe, it, expect } from "vitest";
import { buildFeedbackButtons } from "../src/discord/components";
import { parseFeedbackCustomId } from "../src/discord/feedback";
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
    expect((thumbsUp as any).label).toBe("👍");
    expect((thumbsUp as any).custom_id).toBe("feedback:trace-123:user-456:up");

    expect(thumbsDown!.type).toBe(ComponentType.Button);
    expect((thumbsDown as any).style).toBe(ButtonStyle.Secondary);
    expect((thumbsDown as any).label).toBe("👎");
    expect((thumbsDown as any).custom_id).toBe(
      "feedback:trace-123:user-456:down",
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
