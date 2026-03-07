import { describe, it, expect, vi } from "vitest";
import {
  normalizeNodeId,
  normalizeType,
  createTools,
} from "../src/agent/tools";

describe("normalizeNodeId", () => {
  it('fixes missing colon: "stdlib//irb" → "Stdlib://irb"', () => {
    expect(normalizeNodeId("stdlib//irb")).toBe("Stdlib://irb");
  });

  it("leaves correct format unchanged", () => {
    expect(normalizeNodeId("Stdlib://irb")).toBe("Stdlib://irb");
  });

  it("fixes rubyist casing", () => {
    expect(normalizeNodeId("rubyist://matz")).toBe("Rubyist://matz");
  });

  it("fixes coremodule casing", () => {
    expect(normalizeNodeId("coremodule://String")).toBe("CoreModule://String");
  });

  it("preserves unknown types", () => {
    expect(normalizeNodeId("Unknown://foo")).toBe("Unknown://foo");
  });
});

describe("normalizeType", () => {
  it("normalizes stdlib", () => {
    expect(normalizeType("stdlib")).toBe("Stdlib");
  });

  it("normalizes rubyist", () => {
    expect(normalizeType("rubyist")).toBe("Rubyist");
  });

  it("normalizes coremodule", () => {
    expect(normalizeType("coremodule")).toBe("CoreModule");
  });

  it("preserves already correct type", () => {
    expect(normalizeType("Rubyist")).toBe("Rubyist");
  });

  it("preserves unknown type", () => {
    expect(normalizeType("Unknown")).toBe("Unknown");
  });
});

describe("getNeighbors tool", () => {
  it("normalizes nodeId before calling API", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ neighbors: [] }),
    });
    const fetcher = { fetch: mockFetch } as unknown as Fetcher;
    const tools = createTools(fetcher, "http://api.test");

    await tools.getNeighbors.execute(
      { nodeId: "stdlib//irb", direction: undefined },
      { toolCallId: "test", messages: [], abortSignal: undefined as never },
    );

    const calledUrl = mockFetch.mock.calls[0]![0] as string;
    expect(calledUrl).toContain("nodeId=Stdlib%3A%2F%2Firb");
  });
});

describe("searchNodes tool", () => {
  it("normalizes type before calling API", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ nodes: [] }),
    });
    const fetcher = { fetch: mockFetch } as unknown as Fetcher;
    const tools = createTools(fetcher, "http://api.test");

    await tools.searchNodes.execute(
      { type: "stdlib" as "Stdlib", query: "irb" },
      { toolCallId: "test", messages: [], abortSignal: undefined as never },
    );

    const calledUrl = mockFetch.mock.calls[0]![0] as string;
    expect(calledUrl).toContain("type=Stdlib");
  });
});
