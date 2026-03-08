import type {
  OnFinishEvent,
  OnStartEvent,
  OnStepFinishEvent,
  OnStepStartEvent,
  OnToolCallFinishEvent,
  OnToolCallStartEvent,
} from "ai";
import type { TelemetryIntegration } from "ai";
import type { ToolSet } from "ai";

export interface Flushable {
  flush(): Promise<void>;
}

export interface LangfuseConfig {
  publicKey: string;
  secretKey: string;
  baseUrl?: string;
  environment?: string;
  traceId?: string;
}

interface LangfuseEvent {
  id: string;
  type: string;
  timestamp: string;
  body: Record<string, unknown>;
}

interface PendingToolCall {
  id: string;
  startTime: string;
  input: unknown;
}

export interface RecordGuardrailOptions {
  name: string;
  input: unknown;
  output: unknown;
  startTime: string;
  endTime: string;
  metadata?: Record<string, unknown>;
}

export class LangfuseTelemetryIntegration implements TelemetryIntegration {
  private readonly publicKey: string;
  private readonly secretKey: string;
  private readonly baseUrl: string;
  private readonly environment: string | undefined;
  private events: LangfuseEvent[] = [];
  private traceId: string | null = null;
  private agentId: string | null = null;
  private generationIds: Map<number, string> = new Map();
  private pendingToolCalls: Map<string, PendingToolCall> = new Map();

  constructor(config: LangfuseConfig) {
    this.publicKey = config.publicKey;
    this.secretKey = config.secretKey;
    this.baseUrl = config.baseUrl ?? "https://cloud.langfuse.com";
    this.environment = config.environment;
    if (config.traceId) {
      this.traceId = config.traceId;
    }
  }

  createTrace({
    name,
    input,
    metadata,
  }: {
    name: string;
    input: unknown;
    metadata?: Record<string, unknown>;
  }): string {
    this.traceId = crypto.randomUUID();
    this.events.push({
      id: crypto.randomUUID(),
      type: "trace-create",
      timestamp: new Date().toISOString(),
      body: {
        id: this.traceId,
        name,
        input,
        environment: this.environment,
        ...(metadata && { metadata }),
      },
    });
    return this.traceId;
  }

  recordGuardrail(options: RecordGuardrailOptions): void {
    this.events.push({
      id: crypto.randomUUID(),
      type: "guardrail-create",
      timestamp: new Date().toISOString(),
      body: {
        id: crypto.randomUUID(),
        traceId: this.traceId,
        name: options.name,
        input: options.input,
        output: options.output,
        startTime: options.startTime,
        endTime: options.endTime,
        ...(options.metadata && { metadata: options.metadata }),
      },
    });
  }

  async flush(): Promise<void> {
    if (this.events.length === 0) {
      return;
    }

    const url = `${this.baseUrl}/api/public/ingestion`;
    const auth = `Basic ${btoa(`${this.publicKey}:${this.secretKey}`)}`;

    try {
      await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: auth,
        },
        body: JSON.stringify({ batch: this.events }),
      });
    } catch {
      // Silently handle fetch failures
    }

    this.events = [];
  }

  onStart = async (event: OnStartEvent<ToolSet>): Promise<void> => {
    if (!this.traceId) {
      this.traceId = crypto.randomUUID();
      this.events.push({
        id: crypto.randomUUID(),
        type: "trace-create",
        timestamp: new Date().toISOString(),
        body: {
          id: this.traceId,
          name: "ai-generate-text",
          input: event.prompt,
          environment: this.environment,
          metadata: {
            model: event.model?.modelId,
            provider: event.model?.provider,
          },
        },
      });
    }

    this.agentId = crypto.randomUUID();
    this.events.push({
      id: crypto.randomUUID(),
      type: "agent-create",
      timestamp: new Date().toISOString(),
      body: {
        id: this.agentId,
        traceId: this.traceId,
        name: "ask-llm",
        startTime: new Date().toISOString(),
      },
    });
  };

  onStepStart = async (event: OnStepStartEvent<ToolSet>): Promise<void> => {
    const generationId = crypto.randomUUID();
    const stepNumber = event.stepNumber ?? 0;
    this.generationIds.set(stepNumber, generationId);

    this.events.push({
      id: crypto.randomUUID(),
      type: "generation-create",
      timestamp: new Date().toISOString(),
      body: {
        id: generationId,
        traceId: this.traceId,
        parentObservationId: this.agentId,
        name: `step-${stepNumber}`,
        model: event.model?.modelId,
        startTime: new Date().toISOString(),
        input: [
          ...(event.system
            ? [{ role: "system" as const, content: event.system }]
            : []),
          ...(event.messages ?? []),
        ],
      },
    });
  };

  onToolCallStart = async (
    event: OnToolCallStartEvent<ToolSet>,
  ): Promise<void> => {
    const toolCallId = event.toolCall.toolCallId;

    this.pendingToolCalls.set(toolCallId, {
      id: crypto.randomUUID(),
      startTime: new Date().toISOString(),
      input: event.toolCall.input,
    });
  };

  onToolCallFinish = async (
    event: OnToolCallFinishEvent<ToolSet>,
  ): Promise<void> => {
    const stepNumber = event.stepNumber ?? 0;
    const toolCallId = event.toolCall.toolCallId;
    const pending = this.pendingToolCalls.get(toolCallId);
    const parentGenerationId = this.generationIds.get(stepNumber);

    this.events.push({
      id: crypto.randomUUID(),
      type: "tool-create",
      timestamp: new Date().toISOString(),
      body: {
        id: pending?.id ?? crypto.randomUUID(),
        traceId: this.traceId,
        parentObservationId: parentGenerationId,
        name: event.toolCall.toolName,
        input: pending?.input,
        output: event.success ? event.output : { error: event.error },
        startTime: pending?.startTime,
        endTime: new Date().toISOString(),
        metadata: {
          durationMs: event.durationMs,
          success: event.success,
        },
      },
    });

    this.pendingToolCalls.delete(toolCallId);
  };

  onStepFinish = async (event: OnStepFinishEvent<ToolSet>): Promise<void> => {
    const stepNumber = event.stepNumber ?? 0;
    const generationId = this.generationIds.get(stepNumber);

    const output: Record<string, unknown> = { text: event.text };
    if (event.reasoningText) {
      output.reasoning = event.reasoningText;
    }

    this.events.push({
      id: crypto.randomUUID(),
      type: "generation-update",
      timestamp: new Date().toISOString(),
      body: {
        id: generationId,
        traceId: this.traceId,
        output,
        endTime: new Date().toISOString(),
        usage: {
          input: event.usage?.inputTokens,
          output: event.usage?.outputTokens,
          total: event.usage.totalTokens,
          unit: "TOKENS",
        },
      },
    });
  };

  onFinish = async (event: OnFinishEvent<ToolSet>): Promise<void> => {
    if (this.agentId) {
      this.events.push({
        id: crypto.randomUUID(),
        type: "span-update",
        timestamp: new Date().toISOString(),
        body: {
          id: this.agentId,
          traceId: this.traceId,
          endTime: new Date().toISOString(),
          output: event.text,
        },
      });
    }

    await this.flush();
  };
}
