import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { trace, ROOT_CONTEXT, TraceFlags } from "@opentelemetry/api";
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
    const provider = container.createTracerProvider();

    if (!provider) {
      const result = await checkGuardrails({
        question,
        openrouter: container.openrouter,
        google: container.google,
        openrouterModel: container.modelConfig.openrouterGuardModel,
        aiStudioModel: container.modelConfig.aiStudioGuardModel,
        locale,
      });
      return { ...result, traceId: undefined };
    }

    const tracer = provider.getTracer("ask-workflow");
    let traceId: string | undefined;

    try {
      const result = await tracer.startActiveSpan(
        "ask-workflow",
        async (rootSpan) => {
          traceId = rootSpan.spanContext().traceId;
          rootSpan.setAttribute("question", question);
          rootSpan.setAttribute("locale", locale);

          const guardrailResult = await tracer.startActiveSpan(
            "check-guardrails",
            async (span) => {
              const r = await checkGuardrails({
                question,
                openrouter: container.openrouter,
                google: container.google,
                openrouterModel: container.modelConfig.openrouterGuardModel,
                aiStudioModel: container.modelConfig.aiStudioGuardModel,
                locale,
                tracer,
              });
              span.setAttribute("guardrails.relevant", r.relevant);
              span.end();
              return r;
            },
          );

          rootSpan.end();
          return guardrailResult;
        },
      );

      return { ...result, traceId };
    } finally {
      await provider.forceFlush();
    }
  }

  private async askLLMStep(question: string, locale: string, traceId?: string) {
    const container = createContainer();
    const provider = container.createTracerProvider();
    const tracer = provider?.getTracer("ask-workflow");

    if (!tracer) {
      return askLLM({
        question,
        openrouter: container.openrouter,
        google: container.google,
        openrouterModel: container.modelConfig.openrouterAskModel,
        aiStudioModel: container.modelConfig.aiStudioAskModel,
        tools: container.tools,
        locale,
      });
    }

    try {
      const parentContext = traceId
        ? trace.setSpanContext(ROOT_CONTEXT, {
            traceId,
            spanId: "aaaaaaaaaaaaaaaa",
            traceFlags: TraceFlags.SAMPLED,
            isRemote: true,
          })
        : undefined;

      return await tracer.startActiveSpan(
        "ask-llm",
        {},
        parentContext ?? ROOT_CONTEXT,
        async (span) => {
          try {
            const result = await askLLM({
              question,
              openrouter: container.openrouter,
              google: container.google,
              openrouterModel: container.modelConfig.openrouterAskModel,
              aiStudioModel: container.modelConfig.aiStudioAskModel,
              tools: container.tools,
              locale,
              tracer,
            });
            return result;
          } finally {
            span.end();
          }
        },
      );
    } finally {
      await provider!.forceFlush();
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
