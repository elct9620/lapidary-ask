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
import type { LangfuseTracer } from "./tracer";

interface PendingToolCall {
  id: string;
  startTime: string;
  input: unknown;
}

export interface LangfuseTelemetryIntegrationConfig {
  tracer: LangfuseTracer;
  agentName?: string;
  parentId?: string;
  skipAgentSpan?: boolean;
}

export class LangfuseTelemetryIntegration implements TelemetryIntegration {
  private readonly tracer: LangfuseTracer;
  private readonly agentName: string;
  private readonly parentId: string | undefined;
  private readonly skipAgentSpan: boolean;
  private agentId: string | null = null;
  private generationIds: Map<number, string> = new Map();
  private pendingToolCalls: Map<string, PendingToolCall> = new Map();

  constructor(config: LangfuseTelemetryIntegrationConfig) {
    this.tracer = config.tracer;
    this.agentName = config.agentName ?? "ask-llm";
    this.parentId = config.parentId;
    this.skipAgentSpan = config.skipAgentSpan ?? false;
  }

  onStart = async (_event: OnStartEvent<ToolSet>): Promise<void> => {
    if (!this.skipAgentSpan) {
      this.agentId = this.tracer.createAgent({ name: this.agentName });
    }
  };

  onStepStart = async (event: OnStepStartEvent<ToolSet>): Promise<void> => {
    const stepNumber = event.stepNumber ?? 0;
    const generationId = this.tracer.createGeneration({
      parentId: this.parentId ?? this.agentId,
      name: `step-${stepNumber}`,
      model: event.model?.modelId,
      input: [
        ...(event.system
          ? [{ role: "system" as const, content: event.system }]
          : []),
        ...(event.messages ?? []),
      ],
    });
    this.generationIds.set(stepNumber, generationId);
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

    this.tracer.createTool({
      parentId: parentGenerationId ?? null,
      name: event.toolCall.toolName,
      input: pending?.input,
      output: event.success ? event.output : { error: event.error },
      startTime: pending?.startTime ?? new Date().toISOString(),
      endTime: new Date().toISOString(),
      metadata: {
        durationMs: event.durationMs,
        success: event.success,
      },
    });

    this.pendingToolCalls.delete(toolCallId);
  };

  onStepFinish = async (event: OnStepFinishEvent<ToolSet>): Promise<void> => {
    const stepNumber = event.stepNumber ?? 0;
    const generationId = this.generationIds.get(stepNumber);
    if (!generationId) return;

    const output: Record<string, unknown> = { text: event.text };
    if (event.reasoningText) {
      output.reasoning = event.reasoningText;
    }

    this.tracer.endGeneration(generationId, {
      output,
      model: event.response?.modelId,
      usage: event.usage
        ? {
            input: event.usage.inputTokens,
            output: event.usage.outputTokens,
            total: event.usage.totalTokens,
          }
        : undefined,
      ...(event.providerMetadata?.openrouter && {
        metadata: { openrouter: event.providerMetadata.openrouter },
      }),
    });
  };

  onFinish = async (event: OnFinishEvent<ToolSet>): Promise<void> => {
    if (this.agentId) {
      this.tracer.endAgent(this.agentId, event.text);
    }

    await this.tracer.flush();
  };
}
