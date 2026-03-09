import {
  ComponentType,
  ButtonStyle,
  type APIActionRowComponent,
  type APIComponentInMessageActionRow,
} from "discord-api-types/v10";
import { buildFeedbackCustomId } from "./feedback";

export function buildFeedbackButtons(
  traceId: string,
  userId: string,
): APIActionRowComponent<APIComponentInMessageActionRow>[] {
  return [
    {
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.Button,
          style: ButtonStyle.Secondary,
          label: "👍",
          custom_id: buildFeedbackCustomId(traceId, userId, "up"),
        },
        {
          type: ComponentType.Button,
          style: ButtonStyle.Secondary,
          label: "👎",
          custom_id: buildFeedbackCustomId(traceId, userId, "down"),
        },
      ],
    },
  ];
}
