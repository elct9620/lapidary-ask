import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { askLLM, checkGuardrails } from "../agent";
import { patchDiscordResponse } from "../discord/api";
import { buildFeedbackButtons } from "../discord/components";
import { formatForDiscord } from "../format";
import { t } from "../locale";
import { createTelemetryContext } from "../telemetry/context";

const GUARDRAILS_STEP_CONFIG = {
  timeout: "1 minute" as const,
  retries: { limit: 0, delay: "1 second" as const },
};

const DISCORD_POST_STEP_CONFIG = {
  timeout: "30 seconds" as const,
  retries: { limit: 2, delay: "2 seconds" as const },
};

const LLM_STEP_CONFIG = {
  timeout: "5 minutes" as const,
  retries: { limit: 1, delay: "5 seconds" as const },
};

const FIRE_AND_FORGET_STEP_CONFIG = {
  timeout: "30 seconds" as const,
  retries: { limit: 0, delay: "1 second" as const },
};

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

    const traceId = tracer?.createTrace({
      name: "ask-workflow",
      input: { question, locale },
    });

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
      GUARDRAILS_STEP_CONFIG,
      () => this.checkGuardrailsStep(question, locale),
    );

    if (!guardrails.relevant) {
      await step.do(
        "post-guardrails-rejection",
        DISCORD_POST_STEP_CONFIG,
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
      answer = await step.do("ask-llm", LLM_STEP_CONFIG, () =>
        this.askLLMStep(question, locale, guardrails.traceId),
      );
    } catch (error) {
      await step.do(
        "report-llm-error",
        FIRE_AND_FORGET_STEP_CONFIG,
        async () => {
          await patchDiscordResponse(applicationId, interactionToken, {
            content: t("llmProcessingFailed", locale),
          });
        },
      );
      return;
    }

    try {
      await step.do("post-response", DISCORD_POST_STEP_CONFIG, async () => {
        const content = formatForDiscord(answer);
        const components = guardrails.traceId
          ? buildFeedbackButtons(guardrails.traceId, userId)
          : undefined;
        await patchDiscordResponse(applicationId, interactionToken, {
          content,
          components,
        });
      });
    } catch (error) {
      await step.do(
        "report-post-error",
        FIRE_AND_FORGET_STEP_CONFIG,
        async () => {
          await patchDiscordResponse(applicationId, interactionToken, {
            content: t("postResponseFailed", locale),
          });
        },
      );
    }
  }
}
