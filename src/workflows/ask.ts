import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { askLLM, checkGuardrails } from "../agent";
import { patchDiscordResponse } from "../discord/api";
import { formatForDiscord } from "../format";
import { LangfuseTelemetryIntegration } from "../telemetry/langfuse";

function createTelemetryIntegration(
  env: Env,
  options?: {
    traceId?: string;
  },
): LangfuseTelemetryIntegration | undefined {
  if (!env.LANGFUSE_PUBLIC_KEY || !env.LANGFUSE_SECRET_KEY) {
    return undefined;
  }

  return new LangfuseTelemetryIntegration({
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    secretKey: env.LANGFUSE_SECRET_KEY,
    baseUrl: env.LANGFUSE_BASE_URL,
    environment: env.ENVIRONMENT,
    traceId: options?.traceId,
  });
}

export interface AskWorkflowParams {
  question: string;
  interactionToken: string;
  applicationId: string;
  locale: string;
}

export class AskWorkflow extends WorkflowEntrypoint<Env, AskWorkflowParams> {
  override async run(
    event: WorkflowEvent<AskWorkflowParams>,
    step: WorkflowStep,
  ) {
    const { question, interactionToken, applicationId, locale } = event.payload;

    const guardrails = await step.do(
      "check-guardrails",
      { retries: { limit: 0, delay: "1 second" } },
      async () => {
        const integration = createTelemetryIntegration(this.env);
        let traceId: string | undefined;

        if (integration) {
          traceId = integration.createTrace({
            name: "ask-workflow",
            input: { question, locale },
          });
        }

        integration?.beginGuardrail();

        const startTime = new Date().toISOString();
        const result = await checkGuardrails({
          question,
          apiKey: this.env.OPENROUTER_API_KEY,
          locale,
          integrations: integration ? [integration] : undefined,
        });
        const endTime = new Date().toISOString();

        integration?.endGuardrail({
          name: "check-guardrails",
          input: question,
          output: result,
          startTime,
          endTime,
        });
        await integration?.flush();

        return { ...result, traceId };
      },
    );

    if (!guardrails.relevant) {
      await step.do(
        "post-guardrails-rejection",
        { retries: { limit: 2, delay: "2 seconds" } },
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
        { retries: { limit: 1, delay: "5 seconds" } },
        async () => {
          const llmIntegration = createTelemetryIntegration(this.env, {
            traceId: guardrails.traceId,
          });
          const integrations = llmIntegration ? [llmIntegration] : undefined;

          return await askLLM({
            question,
            apiKey: this.env.OPENROUTER_API_KEY,
            internalApi: this.env.INTERNAL_API,
            internalApiUrl: this.env.INTERNAL_API_URL,
            locale,
            integrations,
          });
        },
      );
    } catch (error) {
      await step.do(
        "report-llm-error",
        { retries: { limit: 0, delay: "1 second" } },
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
        { retries: { limit: 2, delay: "2 seconds" } },
        async () => {
          const content = formatForDiscord(answer);
          await patchDiscordResponse(applicationId, interactionToken, {
            content,
          });
        },
      );
    } catch (error) {
      await step.do(
        "report-post-error",
        { retries: { limit: 0, delay: "1 second" } },
        async () => {
          await patchDiscordResponse(applicationId, interactionToken, {
            content: "Failed to post response. Please try again later.",
          });
        },
      );
    }
  }
}
