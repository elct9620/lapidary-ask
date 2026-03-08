import type { LangfuseClient } from "./client";

export interface LangfuseTracerConfig {
  client: LangfuseClient;
  environment?: string;
}

export class LangfuseTracer {
  private readonly client: LangfuseClient;
  private readonly environment: string | undefined;
  private _traceId: string | null = null;

  constructor(config: LangfuseTracerConfig) {
    this.client = config.client;
    this.environment = config.environment;
  }

  get traceId(): string | null {
    return this._traceId;
  }

  setTraceId(traceId: string): void {
    this._traceId = traceId;
  }

  createTrace(options: {
    name: string;
    input: unknown;
    metadata?: Record<string, unknown>;
  }): string {
    this._traceId = crypto.randomUUID();
    this.client.emit({
      id: crypto.randomUUID(),
      type: "trace-create",
      timestamp: new Date().toISOString(),
      body: {
        id: this._traceId,
        name: options.name,
        input: options.input,
        environment: this.environment,
        ...(options.metadata && { metadata: options.metadata }),
      },
    });
    return this._traceId;
  }

  createAgent(options: { name: string }): string {
    const agentId = crypto.randomUUID();
    this.client.emit({
      id: crypto.randomUUID(),
      type: "agent-create",
      timestamp: new Date().toISOString(),
      body: {
        id: agentId,
        traceId: this._traceId,
        name: options.name,
        startTime: new Date().toISOString(),
      },
    });
    return agentId;
  }

  endAgent(agentId: string, output: unknown): void {
    this.client.emit({
      id: crypto.randomUUID(),
      type: "agent-update",
      timestamp: new Date().toISOString(),
      body: {
        id: agentId,
        traceId: this._traceId,
        endTime: new Date().toISOString(),
        output,
      },
    });
  }

  createGeneration(options: {
    parentId: string | null;
    name: string;
    model?: string;
    input: unknown;
  }): string {
    const generationId = crypto.randomUUID();
    this.client.emit({
      id: crypto.randomUUID(),
      type: "generation-create",
      timestamp: new Date().toISOString(),
      body: {
        id: generationId,
        traceId: this._traceId,
        parentObservationId: options.parentId,
        name: options.name,
        model: options.model,
        startTime: new Date().toISOString(),
        input: options.input,
      },
    });
    return generationId;
  }

  endGeneration(
    generationId: string,
    options: {
      output: unknown;
      model?: string;
      usage?: { input?: number; output?: number; total?: number };
      metadata?: Record<string, unknown>;
    },
  ): void {
    this.client.emit({
      id: crypto.randomUUID(),
      type: "generation-update",
      timestamp: new Date().toISOString(),
      body: {
        id: generationId,
        traceId: this._traceId,
        model: options.model,
        output: options.output,
        endTime: new Date().toISOString(),
        ...(options.metadata && { metadata: options.metadata }),
        usage: options.usage ? { ...options.usage, unit: "TOKENS" } : undefined,
      },
    });
  }

  createTool(options: {
    parentId: string | null;
    name: string;
    input: unknown;
    output: unknown;
    startTime: string;
    endTime: string;
    metadata?: Record<string, unknown>;
  }): string {
    const toolId = crypto.randomUUID();
    this.client.emit({
      id: crypto.randomUUID(),
      type: "tool-create",
      timestamp: new Date().toISOString(),
      body: {
        id: toolId,
        traceId: this._traceId,
        parentObservationId: options.parentId,
        name: options.name,
        input: options.input,
        output: options.output,
        startTime: options.startTime,
        endTime: options.endTime,
        ...(options.metadata && { metadata: options.metadata }),
      },
    });
    return toolId;
  }

  createGuardrail(options: {
    name: string;
    input: unknown;
    output: unknown;
    startTime: string;
    endTime: string;
    metadata?: Record<string, unknown>;
  }): string {
    const guardrailId = crypto.randomUUID();
    this.client.emit({
      id: crypto.randomUUID(),
      type: "guardrail-create",
      timestamp: new Date().toISOString(),
      body: {
        id: guardrailId,
        traceId: this._traceId,
        name: options.name,
        input: options.input,
        output: options.output,
        startTime: options.startTime,
        endTime: options.endTime,
        ...(options.metadata && { metadata: options.metadata }),
      },
    });
    return guardrailId;
  }

  async flush(): Promise<void> {
    await this.client.flush();
  }
}
