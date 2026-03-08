import { describe, it, expect, vi, beforeEach } from "vitest";
import { LangfuseTelemetryIntegration } from "../src/telemetry/langfuse";

describe("LangfuseTelemetryIntegration", () => {
  let integration: LangfuseTelemetryIntegration;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    let uuidCounter = 0;
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => `uuid-${++uuidCounter}`),
    });

    integration = new LangfuseTelemetryIntegration({
      publicKey: "pk-test",
      secretKey: "sk-test",
    });
  });

  it("collects events through lifecycle hooks and batches them", async () => {
    await integration.onStart!({
      model: { provider: "openrouter", modelId: "openrouter/free" },
      prompt: "What is Ruby?",
    } as any);

    await integration.onStepStart!({
      stepNumber: 0,
      model: { provider: "openrouter", modelId: "openrouter/free" },
    } as any);

    await integration.onToolCallStart!({
      stepNumber: 0,
      toolCall: { toolName: "searchNodes", args: { query: "Ruby" } },
    } as any);

    await integration.onToolCallFinish!({
      stepNumber: 0,
      toolCall: { toolName: "searchNodes", args: { query: "Ruby" } },
      success: true,
      output: [{ name: "Ruby" }],
      durationMs: 150,
    } as any);

    await integration.onStepFinish!({
      stepNumber: 0,
      usage: { inputTokens: 100, outputTokens: 50 },
      text: "Ruby is a language",
    } as any);

    await integration.onFinish!({
      text: "Ruby is a language",
      totalUsage: { inputTokens: 100, outputTokens: 50 },
    } as any);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://cloud.langfuse.com/api/public/ingestion");
    expect(options.method).toBe("POST");

    const body = JSON.parse(options.body);
    expect(body.batch).toHaveLength(5);

    const types = body.batch.map((e: any) => e.type);
    expect(types).toContain("trace-create");
    expect(types).toContain("generation-create");
    expect(types).toContain("span-create");
    expect(types).toContain("span-update");
    expect(types).toContain("generation-update");
  });

  it("sends correct auth header", async () => {
    await integration.onStart!({
      model: { provider: "openrouter", modelId: "openrouter/free" },
      prompt: "test",
    } as any);

    await integration.onFinish!({
      text: "response",
      totalUsage: { inputTokens: 10, outputTokens: 5 },
    } as any);

    const [, options] = fetchSpy.mock.calls[0];
    const expectedAuth = `Basic ${btoa("pk-test:sk-test")}`;
    expect(options.headers["Authorization"]).toBe(expectedAuth);
    expect(options.headers["Content-Type"]).toBe("application/json");
  });

  it("silently handles fetch failures", async () => {
    fetchSpy.mockRejectedValue(new Error("Network error"));

    await integration.onStart!({
      model: { provider: "openrouter", modelId: "openrouter/free" },
      prompt: "test",
    } as any);

    await integration.onFinish!({
      text: "response",
      totalUsage: { inputTokens: 10, outputTokens: 5 },
    } as any);

    expect(fetchSpy).toHaveBeenCalledOnce();
    // Should not throw
  });

  it("skips send when no events collected", async () => {
    await integration.onFinish!({
      text: "response",
      totalUsage: { inputTokens: 10, outputTokens: 5 },
    } as any);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uses custom base URL when provided", async () => {
    integration = new LangfuseTelemetryIntegration({
      publicKey: "pk-test",
      secretKey: "sk-test",
      baseUrl: "https://custom.langfuse.com",
    });

    await integration.onStart!({
      model: { provider: "openrouter", modelId: "openrouter/free" },
      prompt: "test",
    } as any);

    await integration.onFinish!({
      text: "response",
      totalUsage: { inputTokens: 10, outputTokens: 5 },
    } as any);

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://custom.langfuse.com/api/public/ingestion");
  });

  it("creates correct parent-child relationships", async () => {
    await integration.onStart!({
      model: { provider: "openrouter", modelId: "openrouter/free" },
      prompt: "test",
    } as any);

    await integration.onStepStart!({
      stepNumber: 0,
      model: { provider: "openrouter", modelId: "openrouter/free" },
    } as any);

    await integration.onToolCallStart!({
      stepNumber: 0,
      toolCall: { toolName: "searchNodes", args: { query: "Ruby" } },
    } as any);

    await integration.onToolCallFinish!({
      stepNumber: 0,
      toolCall: { toolName: "searchNodes", args: { query: "Ruby" } },
      success: true,
      output: [],
      durationMs: 100,
    } as any);

    await integration.onStepFinish!({
      stepNumber: 0,
      usage: { inputTokens: 50, outputTokens: 25 },
      text: "response",
    } as any);

    await integration.onFinish!({
      text: "response",
      totalUsage: { inputTokens: 50, outputTokens: 25 },
    } as any);

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);

    const traceEvent = body.batch.find((e: any) => e.type === "trace-create");
    const generationCreate = body.batch.find(
      (e: any) => e.type === "generation-create",
    );
    const spanCreate = body.batch.find((e: any) => e.type === "span-create");

    // Assert relationships using actual IDs from events, not hardcoded UUIDs
    expect(generationCreate.body.traceId).toBe(traceEvent.body.id);
    expect(spanCreate.body.traceId).toBe(traceEvent.body.id);
    expect(spanCreate.body.parentObservationId).toBe(generationCreate.body.id);
  });

  it("includes matching span ID in span-update", async () => {
    await integration.onStart!({
      model: { provider: "openrouter", modelId: "openrouter/free" },
      prompt: "test",
    } as any);

    await integration.onStepStart!({
      stepNumber: 0,
      model: { provider: "openrouter", modelId: "openrouter/free" },
    } as any);

    await integration.onToolCallStart!({
      stepNumber: 0,
      toolCall: { toolName: "searchNodes", args: { query: "Ruby" } },
    } as any);

    await integration.onToolCallFinish!({
      stepNumber: 0,
      toolCall: { toolName: "searchNodes", args: { query: "Ruby" } },
      success: true,
      output: [{ name: "Ruby" }],
      durationMs: 100,
    } as any);

    await integration.onFinish!({
      text: "response",
      totalUsage: { inputTokens: 50, outputTokens: 25 },
    } as any);

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);

    const spanCreate = body.batch.find((e: any) => e.type === "span-create");
    const spanUpdate = body.batch.find((e: any) => e.type === "span-update");

    expect(spanUpdate.body.id).toBe(spanCreate.body.id);
  });
});
