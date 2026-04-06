import { describe, it, expect, vi, beforeEach } from "vitest";
import { LangfuseClient } from "../src/telemetry/client";

describe("LangfuseClient", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
  });

  it("sends score-create event via POST", async () => {
    const client = new LangfuseClient({
      publicKey: "pk-test",
      secretKey: "sk-test",
    });

    await client.createScore("trace-123", "user-feedback", 1);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://cloud.langfuse.com/api/public/ingestion");
    expect(options.method).toBe("POST");

    const body = JSON.parse(options.body);
    expect(body.batch).toHaveLength(1);
    expect(body.batch[0].type).toBe("score-create");
  });

  it("sends correct auth header", async () => {
    const client = new LangfuseClient({
      publicKey: "pk-test",
      secretKey: "sk-test",
    });

    await client.createScore("trace-123", "user-feedback", 1);

    const [, options] = fetchSpy.mock.calls[0];
    const expectedAuth = `Basic ${btoa("pk-test:sk-test")}`;
    expect(options.headers["Authorization"]).toBe(expectedAuth);
    expect(options.headers["Content-Type"]).toBe("application/json");
  });

  it("uses custom base URL", async () => {
    const client = new LangfuseClient({
      publicKey: "pk-test",
      secretKey: "sk-test",
      baseUrl: "https://custom.langfuse.com",
    });

    await client.createScore("trace-123", "user-feedback", 1);

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://custom.langfuse.com/api/public/ingestion");
  });

  it("sends correct score body shape", async () => {
    const client = new LangfuseClient({
      publicKey: "pk-test",
      secretKey: "sk-test",
    });

    await client.createScore("trace-123", "user-feedback", -1);

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const event = body.batch[0];
    expect(event.type).toBe("score-create");
    expect(event.id).toBeDefined();
    expect(event.timestamp).toBeDefined();
    expect(event.body.id).toBeDefined();
    expect(event.body.traceId).toBe("trace-123");
    expect(event.body.name).toBe("user-feedback");
    expect(event.body.value).toBe(-1);
    expect(event.body.dataType).toBe("NUMERIC");
  });

  it("warns on HTTP error response", async () => {
    fetchSpy.mockResolvedValue(new Response("error", { status: 400 }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const client = new LangfuseClient({
      publicKey: "pk-test",
      secretKey: "sk-test",
    });

    await client.createScore("trace-123", "user-feedback", 1);

    expect(warnSpy).toHaveBeenCalledWith("Langfuse score failed: HTTP 400");
    warnSpy.mockRestore();
  });

  it("warns on fetch failure instead of throwing", async () => {
    fetchSpy.mockRejectedValue(new Error("Network error"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const client = new LangfuseClient({
      publicKey: "pk-test",
      secretKey: "sk-test",
    });

    await client.createScore("trace-123", "user-feedback", 1);

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
