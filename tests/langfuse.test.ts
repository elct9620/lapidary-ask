import { describe, it, expect, vi, beforeEach } from "vitest";
import { LangfuseClient } from "../src/telemetry/client";
import { LangfuseTracer } from "../src/telemetry/tracer";
import { LangfuseTelemetryIntegration } from "../src/telemetry/integration";

describe("LangfuseClient", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
  });

  it("sends batched events via POST", async () => {
    const client = new LangfuseClient({
      publicKey: "pk-test",
      secretKey: "sk-test",
    });

    client.emit({
      id: "e1",
      type: "trace-create",
      timestamp: "2025-01-01T00:00:00.000Z",
      body: { id: "t1", name: "test" },
    });

    await client.flush();

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://cloud.langfuse.com/api/public/ingestion");
    expect(options.method).toBe("POST");

    const body = JSON.parse(options.body);
    expect(body.batch).toHaveLength(1);
    expect(body.batch[0].type).toBe("trace-create");
  });

  it("sends correct auth header", async () => {
    const client = new LangfuseClient({
      publicKey: "pk-test",
      secretKey: "sk-test",
    });

    client.emit({
      id: "e1",
      type: "trace-create",
      timestamp: "2025-01-01T00:00:00.000Z",
      body: { id: "t1" },
    });

    await client.flush();

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

    client.emit({
      id: "e1",
      type: "trace-create",
      timestamp: "2025-01-01T00:00:00.000Z",
      body: { id: "t1" },
    });

    await client.flush();

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://custom.langfuse.com/api/public/ingestion");
  });

  it("skips send when no events", async () => {
    const client = new LangfuseClient({
      publicKey: "pk-test",
      secretKey: "sk-test",
    });

    await client.flush();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("clears buffer after flush", async () => {
    const client = new LangfuseClient({
      publicKey: "pk-test",
      secretKey: "sk-test",
    });

    client.emit({
      id: "e1",
      type: "trace-create",
      timestamp: "2025-01-01T00:00:00.000Z",
      body: { id: "t1" },
    });

    await client.flush();
    expect(fetchSpy).toHaveBeenCalledOnce();

    await client.flush();
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("clears buffer even on HTTP error response", async () => {
    fetchSpy.mockResolvedValue(new Response("error", { status: 500 }));

    const client = new LangfuseClient({
      publicKey: "pk-test",
      secretKey: "sk-test",
    });

    client.emit({
      id: "e1",
      type: "trace-create",
      timestamp: "2025-01-01T00:00:00.000Z",
      body: { id: "t1" },
    });

    await client.flush();

    expect(fetchSpy).toHaveBeenCalledOnce();

    // Buffer should be cleared even on error response
    await client.flush();
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("warns on fetch failure instead of throwing", async () => {
    fetchSpy.mockRejectedValue(new Error("Network error"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const client = new LangfuseClient({
      publicKey: "pk-test",
      secretKey: "sk-test",
    });

    client.emit({
      id: "e1",
      type: "trace-create",
      timestamp: "2025-01-01T00:00:00.000Z",
      body: { id: "t1" },
    });

    await client.flush();

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("LangfuseTracer", () => {
  let client: LangfuseClient;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    let uuidCounter = 0;
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => `uuid-${++uuidCounter}`),
    });

    client = new LangfuseClient({
      publicKey: "pk-test",
      secretKey: "sk-test",
    });
  });

  function parseBatch(): any[] {
    return JSON.parse(fetchSpy.mock.calls[0][1].body).batch;
  }

  it("createTrace sets traceId and emits trace-create", async () => {
    const tracer = new LangfuseTracer({ client });
    const traceId = tracer.createTrace({
      name: "test-trace",
      input: { question: "test" },
    });

    expect(traceId).toBe("uuid-1");
    expect(tracer.traceId).toBe("uuid-1");

    await tracer.flush();
    const batch = parseBatch();
    expect(batch).toHaveLength(1);
    expect(batch[0].type).toBe("trace-create");
    expect(batch[0].body.name).toBe("test-trace");
  });

  it("includes environment in trace-create", async () => {
    const tracer = new LangfuseTracer({
      client,
      environment: "production",
    });

    tracer.createTrace({ name: "test", input: "test" });
    await tracer.flush();

    const batch = parseBatch();
    expect(batch[0].body.environment).toBe("production");
  });

  it("omits environment when not provided", async () => {
    const tracer = new LangfuseTracer({ client });
    tracer.createTrace({ name: "test", input: "test" });
    await tracer.flush();

    const batch = parseBatch();
    expect(batch[0].body.environment).toBeUndefined();
  });

  it("createAgent and endAgent use agent-create and agent-update", async () => {
    const tracer = new LangfuseTracer({ client });
    tracer.createTrace({ name: "test", input: "test" });
    const agentId = tracer.createAgent({ name: "ask-llm" });
    tracer.endAgent(agentId, "final response");

    await tracer.flush();
    const batch = parseBatch();

    const agentCreate = batch.find((e: any) => e.type === "agent-create");
    const agentUpdate = batch.find((e: any) => e.type === "agent-update");

    expect(agentCreate).toBeDefined();
    expect(agentCreate.body.name).toBe("ask-llm");
    expect(agentCreate.body.traceId).toBe("uuid-1");

    expect(agentUpdate).toBeDefined();
    expect(agentUpdate.body.id).toBe(agentId);
    expect(agentUpdate.body.output).toBe("final response");
  });

  it("createGeneration and endGeneration work correctly", async () => {
    const tracer = new LangfuseTracer({ client });
    tracer.createTrace({ name: "test", input: "test" });
    const agentId = tracer.createAgent({ name: "ask-llm" });

    const genId = tracer.createGeneration({
      parentId: agentId,
      name: "step-0",
      model: "openrouter/free",
      input: [{ role: "user", content: "Hello" }],
    });

    tracer.endGeneration(genId, {
      output: { text: "response" },
      model: "google/gemma-3-27b-it:free",
      usage: { input: 50, output: 25, total: 75 },
    });

    await tracer.flush();
    const batch = parseBatch();

    const genCreate = batch.find((e: any) => e.type === "generation-create");
    expect(genCreate.body.parentObservationId).toBe(agentId);
    expect(genCreate.body.model).toBe("openrouter/free");

    const genUpdate = batch.find((e: any) => e.type === "generation-update");
    expect(genUpdate.body.model).toBe("google/gemma-3-27b-it:free");
    expect(genUpdate.body.usage).toEqual({
      input: 50,
      output: 25,
      total: 75,
      unit: "TOKENS",
    });
  });

  it("createTool emits tool-create with parent", async () => {
    const tracer = new LangfuseTracer({ client });
    tracer.createTrace({ name: "test", input: "test" });

    tracer.createTool({
      parentId: "gen-1",
      name: "searchNodes",
      input: { query: "Ruby" },
      output: [{ name: "Ruby" }],
      startTime: "2025-01-01T00:00:00.000Z",
      endTime: "2025-01-01T00:00:01.000Z",
      metadata: { durationMs: 100, success: true },
    });

    await tracer.flush();
    const batch = parseBatch();
    const toolEvent = batch.find((e: any) => e.type === "tool-create");

    expect(toolEvent.body.name).toBe("searchNodes");
    expect(toolEvent.body.parentObservationId).toBe("gen-1");
    expect(toolEvent.body.input).toEqual({ query: "Ruby" });
    expect(toolEvent.body.output).toEqual([{ name: "Ruby" }]);
  });

  it("createGuardrail emits guardrail-create", async () => {
    const tracer = new LangfuseTracer({ client });
    tracer.createTrace({ name: "test", input: "test" });

    tracer.createGuardrail({
      name: "check-guardrails",
      input: "What is Ruby?",
      output: { relevant: true, reason: "" },
      startTime: "2025-01-01T00:00:00.000Z",
      endTime: "2025-01-01T00:00:01.000Z",
    });

    await tracer.flush();
    const batch = parseBatch();
    const guardrailEvent = batch.find(
      (e: any) => e.type === "guardrail-create",
    );

    expect(guardrailEvent).toBeDefined();
    expect(guardrailEvent.body.name).toBe("check-guardrails");
    expect(guardrailEvent.body.traceId).toBe("uuid-1");
  });

  it("setTraceId allows using existing trace", async () => {
    const tracer = new LangfuseTracer({ client });
    tracer.setTraceId("existing-trace-id");

    const agentId = tracer.createAgent({ name: "ask-llm" });
    await tracer.flush();

    const batch = parseBatch();
    const agentCreate = batch.find((e: any) => e.type === "agent-create");
    expect(agentCreate.body.traceId).toBe("existing-trace-id");
  });
});

describe("LangfuseTelemetryIntegration", () => {
  let client: LangfuseClient;
  let tracer: LangfuseTracer;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    let uuidCounter = 0;
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => `uuid-${++uuidCounter}`),
    });

    client = new LangfuseClient({
      publicKey: "pk-test",
      secretKey: "sk-test",
    });
    tracer = new LangfuseTracer({ client });
    tracer.createTrace({ name: "test", input: "test" });
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
      response: { modelId: "google/gemma-3-27b-it:free" },
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
    const integration = new LangfuseTelemetryIntegration({ tracer });
    await runLifecycle(integration, { withToolCall: true });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const batch = parseBatch();
    // trace-create, agent-create, generation-create, tool-create, generation-update, agent-update
    expect(batch).toHaveLength(6);

    const types = batch.map((e: any) => e.type);
    expect(types).toContain("trace-create");
    expect(types).toContain("agent-create");
    expect(types).toContain("generation-create");
    expect(types).toContain("tool-create");
    expect(types).toContain("generation-update");
    expect(types).toContain("agent-update");
  });

  it("creates correct parent-child relationships", async () => {
    const integration = new LangfuseTelemetryIntegration({ tracer });
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
    expect(generationCreate.body.parentObservationId).toBe(agentCreate.body.id);
    // Tool is under generation
    expect(toolCreate.body.parentObservationId).toBe(generationCreate.body.id);
  });

  it("uses custom agentName", async () => {
    const integration = new LangfuseTelemetryIntegration({
      tracer,
      agentName: "custom-agent",
    });
    await runLifecycle(integration);

    const agentCreate = findEvent("agent-create");
    expect(agentCreate.body.name).toBe("custom-agent");
  });

  it("defaults agentName to ask-llm", async () => {
    const integration = new LangfuseTelemetryIntegration({ tracer });
    await runLifecycle(integration);

    const agentCreate = findEvent("agent-create");
    expect(agentCreate.body.name).toBe("ask-llm");
  });

  it("skipAgentSpan skips agent creation and uses parentId for generation", async () => {
    const integration = new LangfuseTelemetryIntegration({
      tracer,
      skipAgentSpan: true,
      parentId: "guardrail-parent",
    });
    await runLifecycle(integration);

    const batch = parseBatch();
    const types = batch.map((e: any) => e.type);

    expect(types).not.toContain("agent-create");
    expect(types).not.toContain("agent-update");

    const genCreate = batch.find((e: any) => e.type === "generation-create");
    expect(genCreate.body.parentObservationId).toBe("guardrail-parent");
  });

  it("skipAgentSpan without parentId sets generation parent to null", async () => {
    const integration = new LangfuseTelemetryIntegration({
      tracer,
      skipAgentSpan: true,
    });
    await runLifecycle(integration);

    const batch = parseBatch();
    const genCreate = batch.find((e: any) => e.type === "generation-create");
    expect(genCreate.body.parentObservationId).toBeNull();
  });

  it("agent-update closes at onFinish", async () => {
    const integration = new LangfuseTelemetryIntegration({ tracer });
    await runLifecycle(integration, {
      finish: { text: "final response" },
    });

    const batch = parseBatch();
    const agentCreate = batch.find((e: any) => e.type === "agent-create");
    const agentUpdate = batch.find(
      (e: any) =>
        e.type === "agent-update" && e.body.id === agentCreate.body.id,
    );

    expect(agentUpdate).toBeDefined();
    expect(agentUpdate.body.output).toBe("final response");
    expect(agentUpdate.body.endTime).toBeDefined();
  });

  it("generation includes input with system and messages", async () => {
    const integration = new LangfuseTelemetryIntegration({ tracer });
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
    const integration = new LangfuseTelemetryIntegration({ tracer });
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
    const integration = new LangfuseTelemetryIntegration({ tracer });
    await runLifecycle(integration);

    const generationUpdate = findEvent("generation-update");
    expect(generationUpdate.body.output).toEqual({ text: "response" });
  });

  it("usage includes total and unit TOKENS", async () => {
    const integration = new LangfuseTelemetryIntegration({ tracer });
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
    const integration = new LangfuseTelemetryIntegration({ tracer });
    await runLifecycle(integration, { withToolCall: true });

    const toolCreate = findEvent("tool-create");
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

  it("handles duplicate tool names via toolCallId", async () => {
    const integration = new LangfuseTelemetryIntegration({ tracer });

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

  it("generation-update includes response modelId and openrouter metadata", async () => {
    const integration = new LangfuseTelemetryIntegration({ tracer });
    await runLifecycle(integration, {
      stepFinish: {
        response: { modelId: "google/gemma-3-27b-it:free" },
        providerMetadata: {
          openrouter: {
            provider: "google",
            usage: { cost: 0 },
          },
        },
      },
    });

    const generationUpdate = findEvent("generation-update");
    expect(generationUpdate.body.model).toBe("google/gemma-3-27b-it:free");
    expect(generationUpdate.body.metadata).toEqual({
      openrouter: {
        provider: "google",
        usage: { cost: 0 },
      },
    });
  });

  it("generation-update omits metadata when no providerMetadata", async () => {
    const integration = new LangfuseTelemetryIntegration({ tracer });
    await runLifecycle(integration, {
      stepFinish: {
        response: { modelId: "google/gemma-3-27b-it:free" },
      },
    });

    const generationUpdate = findEvent("generation-update");
    expect(generationUpdate.body.model).toBe("google/gemma-3-27b-it:free");
    expect(generationUpdate.body.metadata).toBeUndefined();
  });

  it("flushes on onFinish", async () => {
    const integration = new LangfuseTelemetryIntegration({ tracer });
    await runLifecycle(integration);

    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});
