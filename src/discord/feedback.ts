import {
  InteractionResponseType,
  MessageFlags,
  type APIMessageComponentInteraction,
} from "discord-api-types/v10";
import { t } from "../locale";
import type { AppContainer } from "../container";

export const FEEDBACK_PREFIX = "feedback";

export type FeedbackDirection = "up" | "down";

export interface FeedbackData {
  traceId: string;
  userId: string;
  direction: FeedbackDirection;
}

const CUSTOM_ID_MAX_LENGTH = 100;

export function buildFeedbackCustomId(
  traceId: string,
  userId: string,
  direction: FeedbackDirection,
): string {
  const fixedLength =
    FEEDBACK_PREFIX.length + 1 + 1 + userId.length + 1 + direction.length;
  const maxTraceIdLength = Math.max(0, CUSTOM_ID_MAX_LENGTH - fixedLength);
  const truncatedTraceId = traceId.slice(0, maxTraceIdLength);
  return `${FEEDBACK_PREFIX}:${truncatedTraceId}:${userId}:${direction}`;
}

export function parseFeedbackCustomId(customId: string): FeedbackData | null {
  const parts = customId.split(":");
  if (parts.length !== 4) return null;
  if (parts[0] !== FEEDBACK_PREFIX) return null;
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

function ephemeralResponse(content: string): Response {
  return Response.json({
    type: InteractionResponseType.ChannelMessageWithSource,
    data: {
      content,
      flags: MessageFlags.Ephemeral,
    },
  });
}

export function handleFeedbackInteraction(
  interaction: APIMessageComponentInteraction,
  container: Pick<AppContainer, "createLangfuseClient">,
): FeedbackResult {
  const locale = interaction.locale ?? "zh-TW";
  const feedback = parseFeedbackCustomId(interaction.data.custom_id);

  if (!feedback) {
    return { response: ephemeralResponse(t("invalidFeedback", locale)) };
  }

  const interactingUserId =
    interaction.member?.user?.id ?? interaction.user?.id;

  if (interactingUserId !== feedback.userId) {
    return { response: ephemeralResponse(t("onlyAskerCanRate", locale)) };
  }

  let pending: Promise<void> | undefined;

  const client = container.createLangfuseClient();
  if (client) {
    pending = client.createScore(
      feedback.traceId,
      "user-feedback",
      feedback.direction === "up" ? 1 : -1,
    );
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
