import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "../src/agent/prompt";

describe("buildSystemPrompt", () => {
  it("includes general module question handling example", () => {
    const prompt = buildSystemPrompt("en");

    expect(prompt).toContain("Tell me about rdoc");
  });

  it("includes guidance for auto-searching on general questions", () => {
    const prompt = buildSystemPrompt("en");

    expect(prompt).toContain(
      "When a user asks a general question about a Ruby module or library",
    );
  });

  it("includes multi-hop query guidance", () => {
    const prompt = buildSystemPrompt("en");

    expect(prompt).toContain("Multi-Hop Queries (Indirect Relationships)");
  });

  it("includes max traversal depth limit", () => {
    const prompt = buildSystemPrompt("en");

    expect(prompt).toContain("Maximum traversal depth: 3 hops.");
  });

  it("includes the specified response language", () => {
    const prompt = buildSystemPrompt("ja");

    expect(prompt).toContain("Japanese");
  });
});
