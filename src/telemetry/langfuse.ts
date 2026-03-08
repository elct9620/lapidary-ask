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

export interface LangfuseConfig {
  publicKey: string;
  secretKey: string;
  baseUrl?: string;
}

interface LangfuseEvent {
  id: string;
  type: string;
  timestamp: string;
  body: Record<string, unknown>;
}

export class LangfuseTelemetryIntegration implements TelemetryIntegration {
  private readonly publicKey: string;
  private readonly secretKey: string;
  private readonly baseUrl: string;
  private events: LangfuseEvent[] = [];
  private traceId: string | null = null;
  private generationIds: Map<number, string> = new Map();
  private spanIds: Map<string, string> = new Map();

  constructor(config: LangfuseConfig) {
    this.publicKey = config.publicKey;
    this.secretKey = config.secretKey;
    this.baseUrl = config.baseUrl ?? "https://cloud.langfuse.com";

    this.onStart = this.onStart.bind(this);
    this.onStepStart = this.onStepStart.bind(this);
    this.onToolCallStart = this.onToolCallStart.bind(this);
    this.onToolCallFinish = this.onToolCallFinish.bind(this);
    this.onStepFinish = this.onStepFinish.bind(this);
    this.onFinish = this.onFinish.bind(this);
  }

  async onStart(event: OnStartEvent<ToolSet>): Promise<void> {
    this.traceId = crypto.randomUUID();
    this.events.push({
      id: crypto.randomUUID(),
      type: "trace-create",
      timestamp: new Date().toISOString(),
      body: {
        id: this.traceId,
        name: "ai-generate-text",
        input: event.prompt,
        metadata: {
          model: event.model?.modelId,
          provider: event.model?.provider,
        },
      },
    });
  }

  async onStepStart(event: OnStepStartEvent<ToolSet>): Promise<void> {
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
        name: `step-${stepNumber}`,
        model: event.model?.modelId,
        startTime: new Date().toISOString(),
      },
    });
  }

  async onToolCallStart(event: OnToolCallStartEvent<ToolSet>): Promise<void> {
    const stepNumber = event.stepNumber ?? 0;
    const spanId = crypto.randomUUID();
    const parentGenerationId = this.generationIds.get(stepNumber);
    const toolName = event.toolCall?.toolName ?? "unknown";

    this.spanIds.set(`${stepNumber}:${toolName}`, spanId);

    this.events.push({
      id: crypto.randomUUID(),
      type: "span-create",
      timestamp: new Date().toISOString(),
      body: {
        id: spanId,
        traceId: this.traceId,
        parentObservationId: parentGenerationId,
        name: toolName,
        input: event.toolCall?.input,
        startTime: new Date().toISOString(),
      },
    });
  }

  async onToolCallFinish(event: OnToolCallFinishEvent<ToolSet>): Promise<void> {
    const stepNumber = event.stepNumber ?? 0;
    const toolName = event.toolCall?.toolName ?? "unknown";
    const spanId = this.spanIds.get(`${stepNumber}:${toolName}`);

    this.events.push({
      id: crypto.randomUUID(),
      type: "span-update",
      timestamp: new Date().toISOString(),
      body: {
        id: spanId,
        traceId: this.traceId,
        name: toolName,
        output: event.success ? event.output : { error: event.error },
        endTime: new Date().toISOString(),
        metadata: {
          durationMs: event.durationMs,
          success: event.success,
        },
      },
    });
  }

  async onStepFinish(event: OnStepFinishEvent<ToolSet>): Promise<void> {
    const stepNumber = event.stepNumber ?? 0;
    const generationId = this.generationIds.get(stepNumber);

    this.events.push({
      id: crypto.randomUUID(),
      type: "generation-update",
      timestamp: new Date().toISOString(),
      body: {
        id: generationId,
        traceId: this.traceId,
        output: event.text,
        endTime: new Date().toISOString(),
        usage: {
          input: event.usage?.inputTokens,
          output: event.usage?.outputTokens,
        },
      },
    });
  }

  async onFinish(_event: OnFinishEvent<ToolSet>): Promise<void> {
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
  }
}
