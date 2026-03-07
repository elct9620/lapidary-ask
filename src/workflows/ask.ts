import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { askLLM } from "../agent";
import { formatForDiscord } from "../format";

export interface AskWorkflowParams {
  question: string;
  interactionToken: string;
  applicationId: string;
}

const DISCORD_API_BASE = "https://discord.com/api/v10";

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
      await step.do(
        "report-llm-error",
        { retries: { limit: 0, delay: "1 second" } },
        async () => {
          await this.patchDiscordResponse(applicationId, interactionToken, {
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
          await this.patchDiscordResponse(applicationId, interactionToken, {
            content,
          });
        },
      );
    } catch (error) {
      await step.do(
        "report-post-error",
        { retries: { limit: 0, delay: "1 second" } },
        async () => {
          await this.patchDiscordResponse(applicationId, interactionToken, {
            content: "Failed to post response. Please try again later.",
          });
        },
      );
    }
  }

  private async patchDiscordResponse(
    applicationId: string,
    interactionToken: string,
    payload: { content: string },
  ): Promise<void> {
    const url = `${DISCORD_API_BASE}/webhooks/${applicationId}/${interactionToken}/messages/@original`;
    const response = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Discord API error: ${response.status} ${errorText}`);
    }
  }
}
