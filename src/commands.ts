import {
  ApplicationCommandOptionType,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord-api-types/v10";

export const commands: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [
  {
    name: "ask",
    description: "Ask the Lapidary Knowledge Graph via OpenRouter Free Models",
    description_localizations: {
      "zh-TW": "透過 OpenRouter Free Models 查詢 Lapidary 知識圖譜",
      ja: "OpenRouter Free Models を使って Lapidary Knowledge Graph に質問する",
    },
    options: [
      {
        name: "question",
        description: "Your question about Ruby core modules and Rubyists",
        type: ApplicationCommandOptionType.String,
        required: true,
        description_localizations: {
          "zh-TW": "關於 Ruby 核心模組與 Rubyist 的問題",
          ja: "Ruby コアモジュールと Rubyist に関する質問",
        },
      },
    ],
  },
];
