import {
  ApplicationCommandOptionType,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord-api-types/v10";

export const commands: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [
  {
    name: "ask",
    description: "Ask a question to AI",
    options: [
      {
        name: "question",
        description: "The question you want to ask",
        type: ApplicationCommandOptionType.String,
        required: true,
      },
    ],
  },
];
