import { describe, it, expect, vi } from "vitest";
import {
  normalizeNodeId,
  normalizeType,
  createTools,
} from "../src/agent/tools";

describe("normalizeNodeId", () => {
  it('fixes missing colon: "stdlib//irb" → "stdlib://irb"', () => {
    expect(normalizeNodeId("stdlib//irb")).toBe("stdlib://irb");
  });

  it("lowercases type prefix", () => {
    expect(normalizeNodeId("Stdlib://irb")).toBe("stdlib://irb");
  });

  it("lowercases Rubyist prefix", () => {
    expect(normalizeNodeId("Rubyist://matz")).toBe("rubyist://matz");
  });

  it("lowercases CoreModule prefix", () => {
    expect(normalizeNodeId("CoreModule://String")).toBe("coremodule://String");
  });

  it("lowercases unknown types", () => {
    expect(normalizeNodeId("Unknown://foo")).toBe("unknown://foo");
  });

  it("preserves name part casing", () => {
    expect(normalizeNodeId("coremodule://String")).toBe("coremodule://String");
  });
});

describe("normalizeType", () => {
  it("capitalizes stdlib", () => {
    expect(normalizeType("stdlib")).toBe("Stdlib");
  });

  it("preserves Rubyist casing", () => {
    expect(normalizeType("Rubyist")).toBe("Rubyist");
  });

  it("fixes coremodule to CoreModule", () => {
    expect(normalizeType("coremodule")).toBe("CoreModule");
  });

  it("passes through unknown type as-is", () => {
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
      { nodeId: "stdlib//irb" },
      { toolCallId: "test", messages: [], abortSignal: undefined as never },
    );

    const calledUrl = mockFetch.mock.calls[0]![0] as string;
    expect(calledUrl).toContain("node_id=stdlib%3A%2F%2Firb");
    expect(calledUrl).toContain("direction=both");
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
    expect(calledUrl).toContain("q=irb");
  });
});
