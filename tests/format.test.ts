import { describe, it, expect } from "vitest";
import { formatForDiscord } from "../src/format";

describe("formatForDiscord", () => {
  it("returns plain text unchanged", () => {
    expect(formatForDiscord("hello world")).toBe("hello world");
  });

  it("preserves markdown formatting", () => {
    const input = "**bold** and *italic*";
    expect(formatForDiscord(input)).toBe("**bold** and *italic*");
  });

  it("wraps GFM tables in code blocks", () => {
    const input = [
      "| Name | Role |",
      "| --- | --- |",
      "| Alice | Admin |",
      "| Bob | User |",
    ].join("\n");

    const result = formatForDiscord(input);
    expect(result).toContain("```");
    expect(result).toContain("| Name | Role |");
    // Table should be wrapped inside code block
    expect(result).toMatch(/```\n\|.*\|[\s\S]*```/);
  });

  it("wraps table embedded in text", () => {
    const input = [
      "Here are the results:",
      "",
      "| Name | Score |",
      "| --- | --- |",
      "| Alice | 100 |",
      "",
      "That's all.",
    ].join("\n");

    const result = formatForDiscord(input);
    expect(result).toContain("```");
    expect(result).toContain("Here are the results:");
    expect(result).toContain("That's all.");
  });

  it("truncates text exceeding 2000 characters", () => {
    const input = "a".repeat(2500);
    const result = formatForDiscord(input);
    expect(result.length).toBe(2000);
    expect(result.endsWith("...")).toBe(true);
  });

  it("does not split surrogate pairs when truncating", () => {
    // 🎉 is U+1F389, encoded as a surrogate pair in UTF-16
    const emoji = "🎉";
    const filler = "a".repeat(2000 - 3 - 1);
    // Place emoji right at the truncation boundary
    const input = filler + emoji + "b".repeat(500);
    const result = formatForDiscord(input);
    expect(result.length).toBeLessThanOrEqual(2000);
    expect(result.endsWith("...")).toBe(true);
    // Should not contain a lone surrogate
    expect(result).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it("does not truncate text at exactly 2000 characters", () => {
    const input = "a".repeat(2000);
    const result = formatForDiscord(input);
    expect(result.length).toBe(2000);
    expect(result.endsWith("...")).toBe(false);
  });
});
