import type { LangfuseClient } from "./client";

export type ObservationLevel = "DEFAULT" | "DEBUG" | "WARNING" | "ERROR";

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

  private emit(type: string, body: Record<string, unknown>): void {
    this.client.emit({
      id: crypto.randomUUID(),
      type,
      timestamp: new Date().toISOString(),
      body: {
        ...body,
        ...(this.environment && { environment: this.environment }),
      },
    });
  }

  createTrace(options: {
    name: string;
    input: unknown;
    metadata?: Record<string, unknown>;
  }): string {
    this._traceId = crypto.randomUUID();
    this.emit("trace-create", {
      id: this._traceId,
      name: options.name,
      input: options.input,
      ...(options.metadata && { metadata: options.metadata }),
    });
    return this._traceId;
  }

  createAgent(options: { name: string }): string {
    const agentId = crypto.randomUUID();
    this.emit("agent-create", {
      id: agentId,
      traceId: this._traceId,
      name: options.name,
      startTime: new Date().toISOString(),
    });
    return agentId;
  }

  endAgent(
    agentId: string,
    output: unknown,
    options?: { level?: ObservationLevel; statusMessage?: string },
  ): void {
    this.emit("agent-update", {
      id: agentId,
      traceId: this._traceId,
      endTime: new Date().toISOString(),
      output,
      ...(options?.level && { level: options.level }),
      ...(options?.statusMessage && { statusMessage: options.statusMessage }),
    });
  }

  createGeneration(options: {
    parentId: string | null;
    name: string;
    model?: string;
    input: unknown;
  }): string {
    const generationId = crypto.randomUUID();
    this.emit("generation-create", {
      id: generationId,
      traceId: this._traceId,
      parentObservationId: options.parentId,
      name: options.name,
      model: options.model,
      startTime: new Date().toISOString(),
      input: options.input,
    });
    return generationId;
  }

  endGeneration(
    generationId: string,
    options: {
      output: unknown;
      model?: string;
      level?: ObservationLevel;
      statusMessage?: string;
      usage?: { input?: number; output?: number; total?: number };
      metadata?: Record<string, unknown>;
    },
  ): void {
    this.emit("generation-update", {
      id: generationId,
      traceId: this._traceId,
      model: options.model,
      output: options.output,
      ...(options.level && { level: options.level }),
      ...(options.statusMessage && { statusMessage: options.statusMessage }),
      endTime: new Date().toISOString(),
      ...(options.metadata && { metadata: options.metadata }),
      usage: options.usage ? { ...options.usage, unit: "TOKENS" } : undefined,
    });
  }

  createTool(options: {
    parentId: string | null;
    name: string;
    input: unknown;
    output: unknown;
    startTime: string;
    endTime: string;
    level?: ObservationLevel;
    statusMessage?: string;
    metadata?: Record<string, unknown>;
  }): string {
    return this.createObservation("tool", options);
  }

  createGuardrail(options: {
    id?: string;
    name: string;
    input: unknown;
    output: unknown;
    startTime: string;
    endTime: string;
    level?: ObservationLevel;
    statusMessage?: string;
    metadata?: Record<string, unknown>;
  }): string {
    return this.createObservation("guardrail", options);
  }

  private createObservation(
    type: string,
    options: {
      id?: string;
      parentId?: string | null;
      name: string;
      input: unknown;
      output: unknown;
      startTime: string;
      endTime: string;
      level?: ObservationLevel;
      statusMessage?: string;
      metadata?: Record<string, unknown>;
    },
  ): string {
    const id = options.id ?? crypto.randomUUID();
    this.emit(`${type}-create`, {
      id,
      traceId: this._traceId,
      ...(options.parentId !== undefined && {
        parentObservationId: options.parentId,
      }),
      name: options.name,
      input: options.input,
      output: options.output,
      startTime: options.startTime,
      endTime: options.endTime,
      ...(options.level && { level: options.level }),
      ...(options.statusMessage && { statusMessage: options.statusMessage }),
      ...(options.metadata && { metadata: options.metadata }),
    });
    return id;
  }

  async flush(): Promise<void> {
    await this.client.flush();
  }
}
