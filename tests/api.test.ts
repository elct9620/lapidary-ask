import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { patchDiscordResponse } from "../src/discord/api";

describe("patchDiscordResponse", () => {
  let originalFetch: typeof globalThis.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends PATCH request to correct Discord API URL", async () => {
    mockFetch.mockResolvedValue(new Response("ok", { status: 200 }));

    await patchDiscordResponse("app-123", "token-456", {
      content: "Hello!",
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0]!;
    expect(url).toBe(
      "https://discord.com/api/v10/webhooks/app-123/token-456/messages/@original",
    );
    expect(opts.method).toBe("PATCH");
    expect(opts.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(opts.body)).toEqual({ content: "Hello!" });
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValue(new Response("Not Found", { status: 404 }));

    await expect(
      patchDiscordResponse("app-123", "token-456", {
        content: "Hello!",
      }),
    ).rejects.toThrow("Discord API error: 404 Not Found");
  });
});
