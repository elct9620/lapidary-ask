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

  async function runLifecycle(
    inst: LangfuseTelemetryIntegration,
    overrides: {
      stepFinish?: Record<string, unknown>;
      finish?: Record<string, unknown>;
      withToolCall?: boolean;
    } = {},
  ) {
    await inst.onStart!({
      model: { provider: "openrouter", modelId: "openrouter/free" },
      prompt: "test",
    } as any);

    await inst.onStepStart!({
      stepNumber: 0,
      model: { provider: "openrouter", modelId: "openrouter/free" },
      ...(overrides.stepFinish?.system !== undefined && {
        system: overrides.stepFinish.system,
      }),
      ...(overrides.stepFinish?.messages !== undefined && {
        messages: overrides.stepFinish.messages,
      }),
    } as any);

    if (overrides.withToolCall) {
      await inst.onToolCallStart!({
        stepNumber: 0,
        toolCall: {
          toolCallId: "tc-1",
          toolName: "searchNodes",
          input: { query: "Ruby" },
        },
      } as any);

      await inst.onToolCallFinish!({
        stepNumber: 0,
        toolCall: {
          toolCallId: "tc-1",
          toolName: "searchNodes",
          input: { query: "Ruby" },
        },
        success: true,
        output: [{ name: "Ruby" }],
        durationMs: 100,
      } as any);
    }

    await inst.onStepFinish!({
      stepNumber: 0,
      usage: { inputTokens: 50, outputTokens: 25 },
      text: "response",
      ...overrides.stepFinish,
    } as any);

    await inst.onFinish!({
      text: "response",
      totalUsage: { inputTokens: 50, outputTokens: 25 },
      ...overrides.finish,
    } as any);
  }

  function parseBatch(): any[] {
    return JSON.parse(fetchSpy.mock.calls[0][1].body).batch;
  }

  function findEvent(type: string): any {
    return parseBatch().find((e: any) => e.type === type);
  }

  it("collects events through lifecycle hooks and batches them", async () => {
    await runLifecycle(integration, { withToolCall: true });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://cloud.langfuse.com/api/public/ingestion");
    expect(options.method).toBe("POST");

    const batch = parseBatch();
    // trace-create, agent-create, generation-create, tool-create, generation-update, span-update (agent end)
    expect(batch).toHaveLength(6);

    const types = batch.map((e: any) => e.type);
    expect(types).toContain("trace-create");
    expect(types).toContain("agent-create");
    expect(types).toContain("generation-create");
    expect(types).toContain("tool-create");
    expect(types).toContain("generation-update");
    expect(types).toContain("span-update");
  });

  it("sends correct auth header", async () => {
    await runLifecycle(integration);

    const [, options] = fetchSpy.mock.calls[0];
    const expectedAuth = `Basic ${btoa("pk-test:sk-test")}`;
    expect(options.headers["Authorization"]).toBe(expectedAuth);
    expect(options.headers["Content-Type"]).toBe("application/json");
  });

  it("silently handles fetch failures", async () => {
    fetchSpy.mockRejectedValue(new Error("Network error"));

    await runLifecycle(integration);

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

    await runLifecycle(integration);

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://custom.langfuse.com/api/public/ingestion");
  });

  it("includes environment in trace-create body", async () => {
    const envIntegration = new LangfuseTelemetryIntegration({
      publicKey: "pk-test",
      secretKey: "sk-test",
      environment: "production",
    });

    await runLifecycle(envIntegration);

    const traceEvent = findEvent("trace-create");
    expect(traceEvent.body.environment).toBe("production");
  });

  it("omits environment when not provided", async () => {
    await runLifecycle(integration);

    const traceEvent = findEvent("trace-create");
    expect(traceEvent.body.environment).toBeUndefined();
  });

  it("creates correct parent-child relationships with agent", async () => {
    await runLifecycle(integration, { withToolCall: true });

    const batch = parseBatch();
    const traceEvent = batch.find((e: any) => e.type === "trace-create");
    const agentCreate = batch.find((e: any) => e.type === "agent-create");
    const generationCreate = batch.find(
      (e: any) => e.type === "generation-create",
    );
    const toolCreate = batch.find((e: any) => e.type === "tool-create");

    // Agent is under trace
    expect(agentCreate.body.traceId).toBe(traceEvent.body.id);
    // Generation is under agent
    expect(generationCreate.body.traceId).toBe(traceEvent.body.id);
    expect(generationCreate.body.parentObservationId).toBe(agentCreate.body.id);
    // Tool is under generation
    expect(toolCreate.body.traceId).toBe(traceEvent.body.id);
    expect(toolCreate.body.parentObservationId).toBe(generationCreate.body.id);
  });

  it("createTrace() sets traceId and onStart() skips trace creation", async () => {
    const traceId = integration.createTrace({
      name: "ask-workflow",
      input: { question: "test" },
    });

    expect(traceId).toBe("uuid-1");

    await runLifecycle(integration);

    const batch = parseBatch();
    const traceEvents = batch.filter((e: any) => e.type === "trace-create");

    // Only one trace-create from createTrace(), not from onStart()
    expect(traceEvents).toHaveLength(1);
    expect(traceEvents[0].body.name).toBe("ask-workflow");
  });

  it("constructor traceId skips trace creation in onStart()", async () => {
    integration = new LangfuseTelemetryIntegration({
      publicKey: "pk-test",
      secretKey: "sk-test",
      traceId: "existing-trace-id",
    });

    await runLifecycle(integration);

    const batch = parseBatch();
    const traceEvents = batch.filter((e: any) => e.type === "trace-create");

    expect(traceEvents).toHaveLength(0);

    // Agent should reference the existing trace
    const agentCreate = batch.find((e: any) => e.type === "agent-create");
    expect(agentCreate.body.traceId).toBe("existing-trace-id");
  });

  it("recordGuardrail() creates guardrail-create event", async () => {
    integration.createTrace({
      name: "ask-workflow",
      input: { question: "test" },
    });

    integration.recordGuardrail({
      name: "check-guardrails",
      input: "What is Ruby?",
      output: { relevant: true, reason: "" },
      startTime: "2025-01-01T00:00:00.000Z",
      endTime: "2025-01-01T00:00:01.000Z",
    });

    await integration.flush();

    const batch = parseBatch();
    const guardrailEvent = batch.find(
      (e: any) => e.type === "guardrail-create",
    );

    expect(guardrailEvent).toBeDefined();
    expect(guardrailEvent.body.name).toBe("check-guardrails");
    expect(guardrailEvent.body.input).toBe("What is Ruby?");
    expect(guardrailEvent.body.output).toEqual({ relevant: true, reason: "" });
    expect(guardrailEvent.body.traceId).toBe("uuid-1");
    expect(guardrailEvent.body.startTime).toBe("2025-01-01T00:00:00.000Z");
    expect(guardrailEvent.body.endTime).toBe("2025-01-01T00:00:01.000Z");
  });

  it("flush() sends events and clears buffer", async () => {
    integration.createTrace({
      name: "test",
      input: "test",
    });

    await integration.flush();

    expect(fetchSpy).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.batch).toHaveLength(1);

    // Second flush should not send anything
    await integration.flush();
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("generation includes input with system and messages", async () => {
    await runLifecycle(integration, {
      stepFinish: {
        system: "You are a helpful assistant.",
        messages: [{ role: "user", content: "Hello" }],
      },
    });

    const generationCreate = findEvent("generation-create");
    expect(generationCreate.body.input).toEqual([
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hello" },
    ]);
  });

  it("generation output includes reasoning when present", async () => {
    await runLifecycle(integration, {
      stepFinish: { reasoningText: "I think this because..." },
    });

    const generationUpdate = findEvent("generation-update");
    expect(generationUpdate.body.output).toEqual({
      text: "response",
      reasoning: "I think this because...",
    });
  });

  it("generation output omits reasoning when absent", async () => {
    await runLifecycle(integration);

    const generationUpdate = findEvent("generation-update");
    expect(generationUpdate.body.output).toEqual({ text: "response" });
    expect(generationUpdate.body.output.reasoning).toBeUndefined();
  });

  it("usage includes total and unit TOKENS", async () => {
    await runLifecycle(integration, {
      stepFinish: {
        usage: { inputTokens: 50, outputTokens: 25, totalTokens: 75 },
      },
    });

    const generationUpdate = findEvent("generation-update");
    expect(generationUpdate.body.usage).toEqual({
      input: 50,
      output: 25,
      total: 75,
      unit: "TOKENS",
    });
  });

  it("tool-create has complete data from start and finish", async () => {
    await runLifecycle(integration, { withToolCall: true });

    const batch = parseBatch();

    // No span-create events (span-update only for agent end)
    const spanEvents = batch.filter(
      (e: any) => e.type === "span-create" || e.type === "span-update",
    );
    expect(spanEvents.every((e: any) => e.type === "span-update")).toBe(true);

    const toolCreate = batch.find((e: any) => e.type === "tool-create");
    expect(toolCreate).toBeDefined();
    expect(toolCreate.body.name).toBe("searchNodes");
    expect(toolCreate.body.output).toEqual([{ name: "Ruby" }]);
    expect(toolCreate.body.startTime).toBeDefined();
    expect(toolCreate.body.endTime).toBeDefined();
    expect(toolCreate.body.metadata).toEqual({
      durationMs: 100,
      success: true,
    });
  });

  it("agent span-update closes at onFinish", async () => {
    await runLifecycle(integration, {
      finish: { text: "final response" },
    });

    const batch = parseBatch();
    const agentCreate = batch.find((e: any) => e.type === "agent-create");
    const agentEnd = batch.find(
      (e: any) => e.type === "span-update" && e.body.id === agentCreate.body.id,
    );

    expect(agentEnd).toBeDefined();
    expect(agentEnd.body.output).toBe("final response");
    expect(agentEnd.body.endTime).toBeDefined();
  });

  it("handles duplicate tool names in the same step via toolCallId", async () => {
    await integration.onStart!({
      model: { provider: "openrouter", modelId: "openrouter/free" },
      prompt: "test",
    } as any);

    await integration.onStepStart!({
      stepNumber: 0,
      model: { provider: "openrouter", modelId: "openrouter/free" },
    } as any);

    // Two searchNodes calls in the same step
    await integration.onToolCallStart!({
      stepNumber: 0,
      toolCall: {
        toolCallId: "tc-1",
        toolName: "searchNodes",
        input: { query: "Ruby" },
      },
    } as any);

    await integration.onToolCallFinish!({
      stepNumber: 0,
      toolCall: {
        toolCallId: "tc-1",
        toolName: "searchNodes",
        input: { query: "Ruby" },
      },
      success: true,
      output: [{ name: "Ruby" }],
      durationMs: 100,
    } as any);

    await integration.onToolCallStart!({
      stepNumber: 0,
      toolCall: {
        toolCallId: "tc-2",
        toolName: "searchNodes",
        input: { query: "Rails" },
      },
    } as any);

    await integration.onToolCallFinish!({
      stepNumber: 0,
      toolCall: {
        toolCallId: "tc-2",
        toolName: "searchNodes",
        input: { query: "Rails" },
      },
      success: true,
      output: [{ name: "Rails" }],
      durationMs: 80,
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

    const batch = parseBatch();
    const toolEvents = batch.filter((e: any) => e.type === "tool-create");

    expect(toolEvents).toHaveLength(2);
    expect(toolEvents[0].body.input).toEqual({ query: "Ruby" });
    expect(toolEvents[1].body.input).toEqual({ query: "Rails" });
  });
});
