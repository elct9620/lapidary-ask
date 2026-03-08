import { ApplicationCommandOptionType } from "discord-api-types/v10";
import type { DiscordInteraction } from "../discord";

export function getStringOption(
  interaction: DiscordInteraction,
  name: string,
): string | undefined {
  const option = interaction.data?.options?.find((o) => o.name === name);
  if (option?.type === ApplicationCommandOptionType.String) {
    return option.value as string;
  }
  return undefined;
}
