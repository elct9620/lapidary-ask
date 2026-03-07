import { ApplicationCommandOptionType } from "discord-api-types/v10";

interface SlashCommandOption {
  name: string;
  type: number;
  value?: string | number | boolean;
}

interface SlashCommandRaw {
  data?: {
    options?: SlashCommandOption[];
  };
}

function findOption(
  raw: SlashCommandRaw,
  name: string,
): SlashCommandOption | undefined {
  return raw.data?.options?.find((o) => o.name === name);
}

export function getStringOption(
  raw: unknown,
  name: string,
): string | undefined {
  const option = findOption(raw as SlashCommandRaw, name);
  if (option?.type === ApplicationCommandOptionType.String) {
    return option.value as string;
  }
  return undefined;
}
