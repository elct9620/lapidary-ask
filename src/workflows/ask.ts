import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { askLLM } from "../agent";
import { patchDiscordResponse } from "../discord/api";
import { formatForDiscord } from "../format";

export interface AskWorkflowParams {
  question: string;
  interactionToken: string;
  applicationId: string;
}

async function reportError(
  step: WorkflowStep,
  stepName: string,
  applicationId: string,
  interactionToken: string,
  message: string,
): Promise<void> {
  await step.do(
    stepName,
    { retries: { limit: 0, delay: "1 second" } },
    async () => {
      await patchDiscordResponse(applicationId, interactionToken, {
        content: message,
      });
    },
  );
}

export class AskWorkflow extends WorkflowEntrypoint<Env, AskWorkflowParams> {
  override async run(
    event: WorkflowEvent<AskWorkflowParams>,
    step: WorkflowStep,
  ) {
    const { question, interactionToken, applicationId } = event.payload;

    let answer: string;
    try {
      answer = await step.do(
        "ask-llm",
        { retries: { limit: 1, delay: "5 seconds" } },
        async () => {
          return await askLLM(
            question,
            this.env.OPENROUTER_API_KEY,
            this.env.INTERNAL_API,
            this.env.INTERNAL_API_URL,
          );
        },
      );
    } catch (error) {
      await reportError(
        step,
        "report-llm-error",
        applicationId,
        interactionToken,
        "LLM processing failed. Please try again later.",
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
      await reportError(
        step,
        "report-post-error",
        applicationId,
        interactionToken,
        "Failed to post response. Please try again later.",
      );
    }
  }
}
