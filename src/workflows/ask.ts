import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { askLLM, checkGuardrails } from "../agent";
import { buildFeedbackButtons } from "../discord/components";
import { createContainer } from "../container";
import { formatForDiscord } from "../format";
import { t } from "../locale";

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
  locale: string;
  userId: string;
}

export class AskWorkflow extends WorkflowEntrypoint<Env, AskWorkflowParams> {
  private async checkGuardrailsStep(question: string, locale: string) {
    const container = createContainer();
    const guardrailId = crypto.randomUUID();
    const { tracer, integrations } = container.createTelemetryContext({
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
      openrouter: container.openrouter,
      google: container.google,
      openrouterModel: container.modelConfig.openrouterGuardModel,
      aiStudioModel: container.modelConfig.aiStudioGuardModel,
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
    const container = createContainer();
    const { tracer, integrations } = traceId
      ? container.createTelemetryContext({ traceId, agentName: "ask-llm" })
      : { tracer: undefined, integrations: undefined };

    try {
      return await askLLM({
        question,
        openrouter: container.openrouter,
        google: container.google,
        openrouterModel: container.modelConfig.openrouterAskModel,
        aiStudioModel: container.modelConfig.aiStudioAskModel,
        tools: container.tools,
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
    const { question, interactionToken, locale, userId } = event.payload;

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
          const container = createContainer();
          await container.patchDiscordResponse(interactionToken, {
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
          const container = createContainer();
          await container.patchDiscordResponse(interactionToken, {
            content: t("llmProcessingFailed", locale),
          });
        },
      );
      return;
    }

    try {
      await step.do("post-response", DISCORD_POST_STEP_CONFIG, async () => {
        const container = createContainer();
        const content = formatForDiscord(answer);
        const components = guardrails.traceId
          ? buildFeedbackButtons(guardrails.traceId, userId)
          : undefined;
        await container.patchDiscordResponse(interactionToken, {
          content,
          components,
        });
      });
    } catch (error) {
      await step.do(
        "report-post-error",
        FIRE_AND_FORGET_STEP_CONFIG,
        async () => {
          const container = createContainer();
          await container.patchDiscordResponse(interactionToken, {
            content: t("postResponseFailed", locale),
          });
        },
      );
    }
  }
}
