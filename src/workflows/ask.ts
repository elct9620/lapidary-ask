import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { askLLM, checkGuardrails } from "../agent";
import { patchDiscordResponse } from "../discord/api";
import { buildFeedbackButtons } from "../discord/components";
import { formatForDiscord } from "../format";
import { LangfuseClient } from "../telemetry/client";
import { LangfuseTracer } from "../telemetry/tracer";
import { LangfuseTelemetryIntegration } from "../telemetry/integration";

export function createTelemetryContext(
  env: Env,
  options?: {
    traceId?: string;
    agentName?: string;
    skipAgentSpan?: boolean;
    parentId?: string;
  },
): { tracer?: LangfuseTracer; integrations?: LangfuseTelemetryIntegration[] } {
  if (!env.LANGFUSE_PUBLIC_KEY || !env.LANGFUSE_SECRET_KEY) {
    return {};
  }

  const client = new LangfuseClient({
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    secretKey: env.LANGFUSE_SECRET_KEY,
    baseUrl: env.LANGFUSE_BASE_URL,
  });

  const tracer = new LangfuseTracer({
    client,
    environment: env.ENVIRONMENT,
  });

  if (options?.traceId) {
    tracer.setTraceId(options.traceId);
  }

  const integrations = [
    new LangfuseTelemetryIntegration({
      tracer,
      agentName: options?.agentName,
      skipAgentSpan: options?.skipAgentSpan,
      parentId: options?.parentId,
    }),
  ];

  return { tracer, integrations };
}

export interface AskWorkflowParams {
  question: string;
  interactionToken: string;
  applicationId: string;
  locale: string;
  userId: string;
}

export class AskWorkflow extends WorkflowEntrypoint<Env, AskWorkflowParams> {
  private async checkGuardrailsStep(question: string, locale: string) {
    const guardrailId = crypto.randomUUID();
    const { tracer, integrations } = createTelemetryContext(this.env, {
      skipAgentSpan: true,
      parentId: guardrailId,
    });

    let traceId: string | undefined;
    if (tracer) {
      traceId = tracer.createTrace({
        name: "ask-workflow",
        input: { question, locale },
      });
    }

    const startTime = new Date().toISOString();
    const result = await checkGuardrails({
      question,
      apiKey: this.env.OPENROUTER_API_KEY,
      locale,
      integrations,
    });
    const endTime = new Date().toISOString();

    if (tracer) {
      tracer.createGuardrail({
        id: guardrailId,
        name: "check-guardrails",
        input: question,
        output: result,
        startTime,
        endTime,
      });
      await tracer.flush();
    }

    return { ...result, traceId };
  }

  private async askLLMStep(question: string, locale: string, traceId?: string) {
    const { tracer, integrations } = traceId
      ? createTelemetryContext(this.env, { traceId, agentName: "ask-llm" })
      : { tracer: undefined, integrations: undefined };

    try {
      return await askLLM({
        question,
        apiKey: this.env.OPENROUTER_API_KEY,
        internalApi: this.env.INTERNAL_API,
        internalApiUrl: this.env.INTERNAL_API_URL,
        locale,
        integrations,
      });
    } catch (error) {
      await tracer?.flush();
      throw error;
    }
  }

  override async run(
    event: WorkflowEvent<AskWorkflowParams>,
    step: WorkflowStep,
  ) {
    const { question, interactionToken, applicationId, locale, userId } =
      event.payload;

    const guardrails = await step.do(
      "check-guardrails",
      { timeout: "1 minute", retries: { limit: 0, delay: "1 second" } },
      () => this.checkGuardrailsStep(question, locale),
    );

    if (!guardrails.relevant) {
      await step.do(
        "post-guardrails-rejection",
        { timeout: "30 seconds", retries: { limit: 2, delay: "2 seconds" } },
        async () => {
          await patchDiscordResponse(applicationId, interactionToken, {
            content: guardrails.reason,
          });
        },
      );
      return;
    }

    let answer: string;
    try {
      answer = await step.do(
        "ask-llm",
        { timeout: "5 minutes", retries: { limit: 1, delay: "5 seconds" } },
        () => this.askLLMStep(question, locale, guardrails.traceId),
      );
    } catch (error) {
      await step.do(
        "report-llm-error",
        { timeout: "30 seconds", retries: { limit: 0, delay: "1 second" } },
        async () => {
          await patchDiscordResponse(applicationId, interactionToken, {
            content: "LLM processing failed. Please try again later.",
          });
        },
      );
      return;
    }

    try {
      await step.do(
        "post-response",
        { timeout: "30 seconds", retries: { limit: 2, delay: "2 seconds" } },
        async () => {
          const content = formatForDiscord(answer);
          const components = guardrails.traceId
            ? buildFeedbackButtons(guardrails.traceId, userId)
            : undefined;
          await patchDiscordResponse(applicationId, interactionToken, {
            content,
            components,
          });
        },
      );
    } catch (error) {
      await step.do(
        "report-post-error",
        { timeout: "30 seconds", retries: { limit: 0, delay: "1 second" } },
        async () => {
          await patchDiscordResponse(applicationId, interactionToken, {
            content: "Failed to post response. Please try again later.",
          });
        },
      );
    }
  }
}
