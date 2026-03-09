import {
  InteractionResponseType,
  MessageFlags,
  type APIMessageComponentInteraction,
} from "discord-api-types/v10";
import { LangfuseClient } from "../telemetry/client";

export interface FeedbackData {
  traceId: string;
  userId: string;
  direction: "up" | "down";
}

export function parseFeedbackCustomId(customId: string): FeedbackData | null {
  const parts = customId.split(":");
  if (parts.length !== 4) return null;
  if (parts[0] !== "feedback") return null;
  if (parts[3] !== "up" && parts[3] !== "down") return null;

  return {
    traceId: parts[1]!,
    userId: parts[2]!,
    direction: parts[3],
  };
}

export interface FeedbackResult {
  response: Response;
  pending?: Promise<void>;
}

export function handleFeedbackInteraction(
  interaction: APIMessageComponentInteraction,
  env: Env,
): FeedbackResult {
  const feedback = parseFeedbackCustomId(interaction.data.custom_id);

  if (!feedback) {
    return {
      response: Response.json({
        type: InteractionResponseType.ChannelMessageWithSource,
        data: {
          content: "無效的回饋操作。",
          flags: MessageFlags.Ephemeral,
        },
      }),
    };
  }

  const interactingUserId =
    interaction.member?.user?.id ?? interaction.user?.id;

  if (interactingUserId !== feedback.userId) {
    return {
      response: Response.json({
        type: InteractionResponseType.ChannelMessageWithSource,
        data: {
          content: "只有提問者可以評分。",
          flags: MessageFlags.Ephemeral,
        },
      }),
    };
  }

  let pending: Promise<void> | undefined;

  if (env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY) {
    const client = new LangfuseClient({
      publicKey: env.LANGFUSE_PUBLIC_KEY,
      secretKey: env.LANGFUSE_SECRET_KEY,
      baseUrl: env.LANGFUSE_BASE_URL,
    });

    client.createScore(
      feedback.traceId,
      "user-feedback",
      feedback.direction === "up" ? 1 : 0,
    );

    pending = client.flush();
  }

  return {
    response: Response.json({
      type: InteractionResponseType.UpdateMessage,
      data: {
        components: [],
      },
    }),
    pending,
  };
}
