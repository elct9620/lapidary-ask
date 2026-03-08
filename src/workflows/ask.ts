import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { askLLM, checkGuardrails } from "../agent";
import { patchDiscordResponse } from "../discord/api";
import { formatForDiscord } from "../format";
import { LangfuseTelemetryIntegration } from "../telemetry/langfuse";

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
        return await checkGuardrails({
          question,
          apiKey: this.env.OPENROUTER_API_KEY,
          locale,
        });
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
          const integrations =
            this.env.LANGFUSE_PUBLIC_KEY && this.env.LANGFUSE_SECRET_KEY
              ? [
                  new LangfuseTelemetryIntegration({
                    publicKey: this.env.LANGFUSE_PUBLIC_KEY,
                    secretKey: this.env.LANGFUSE_SECRET_KEY,
                    baseUrl: this.env.LANGFUSE_BASE_URL,
                  }),
                ]
              : undefined;

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
