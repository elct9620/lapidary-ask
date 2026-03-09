import {
  ComponentType,
  ButtonStyle,
  type APIActionRowComponent,
  type APIComponentInMessageActionRow,
} from "discord-api-types/v10";

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
          custom_id: `feedback:${traceId}:${userId}:up`,
        },
        {
          type: ComponentType.Button,
          style: ButtonStyle.Secondary,
          label: "👎",
          custom_id: `feedback:${traceId}:${userId}:down`,
        },
      ],
    },
  ];
}
