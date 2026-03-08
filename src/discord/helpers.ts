import {
  ApplicationCommandOptionType,
  type APIChatInputApplicationCommandInteraction,
} from "discord-api-types/v10";

export function getStringOption(
  interaction: APIChatInputApplicationCommandInteraction,
  name: string,
): string | undefined {
  const option = interaction.data?.options?.find((o) => o.name === name);
  if (option?.type === ApplicationCommandOptionType.String) {
    return option.value as string;
  }
  return undefined;
}
