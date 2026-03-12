import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  getLanguageName,
  DEFAULT_LOCALE,
} from "../src/agent/prompt";

describe("getLanguageName", () => {
  it("returns Traditional Chinese for zh-TW", () => {
    expect(getLanguageName("zh-TW")).toBe("Traditional Chinese (Taiwan)");
  });

  it("returns Simplified Chinese for zh-CN", () => {
    expect(getLanguageName("zh-CN")).toBe("Simplified Chinese");
  });

  it("returns Japanese for ja", () => {
    expect(getLanguageName("ja")).toBe("Japanese");
  });

  it("returns English for en", () => {
    expect(getLanguageName("en")).toBe("English");
  });

  it("returns English for en-US subtag", () => {
    expect(getLanguageName("en-US")).toBe("English");
  });

  it("falls back to Traditional Chinese for unknown locale", () => {
    expect(getLanguageName("ko")).toBe("Traditional Chinese (Taiwan)");
  });
});

describe("DEFAULT_LOCALE", () => {
  it("is zh-TW", () => {
    expect(DEFAULT_LOCALE).toBe("zh-TW");
  });
});

describe("buildSystemPrompt", () => {
  it("contains all required sections", () => {
    const prompt = buildSystemPrompt("en");

    const requiredSections = [
      "## Data Source",
      "## Tools",
      "## Graph Structure",
      "## Query Planning",
      "## Query Workflow",
      "### Error Handling",
      "## Response Format",
      "## Response Language",
    ];

    for (const section of requiredSections) {
      expect(prompt).toContain(section);
    }
  });

  it("instructs to skip searchNodes when module name is known", () => {
    const prompt = buildSystemPrompt("en");

    expect(prompt).toContain("If the module/library name is already clear");
    expect(prompt).toContain("skip `searchNodes`");
  });

  it("includes stdlib reference in module query example", () => {
    const prompt = buildSystemPrompt("en");

    expect(prompt).toContain("stdlib://rdoc");
    expect(prompt).toContain("The same pattern applies to Stdlib nodes");
  });

  it("includes guidance for auto-searching on general questions", () => {
    const prompt = buildSystemPrompt("en");

    expect(prompt).toContain(
      "When a user asks a general question about a Ruby module or library",
    );
  });

  it("includes query planning section", () => {
    const prompt = buildSystemPrompt("en");

    expect(prompt).toContain("## Query Planning");
  });

  it("includes intent interpretation guidance for ambiguous queries", () => {
    const prompt = buildSystemPrompt("en");

    expect(prompt).toContain("Intent interpretation");
    expect(prompt).toContain("ReDOS");
    expect(prompt).toContain("Regexp");
  });

  it("describes graph structure: edges only between Rubyist and Module/Stdlib", () => {
    const prompt = buildSystemPrompt("en");

    expect(prompt).toContain("## Graph Structure");
    expect(prompt).toContain("Rubyist ↔ CoreModule");
    expect(prompt).toContain("Rubyist ↔ Stdlib");
    expect(prompt).toMatch(/no direct edge.*Rubyist.*Rubyist/i);
    expect(prompt).toContain("getNeighbors");
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

  it("uses fallback language for unknown locale", () => {
    const prompt = buildSystemPrompt("ko");

    expect(prompt).toContain("Traditional Chinese (Taiwan)");
  });
});
