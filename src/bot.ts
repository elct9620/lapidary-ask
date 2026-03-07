import { Chat } from "chat";
import { createDiscordAdapter } from "./adapter/discord";
import { createMemoryState } from "@chat-adapter/state-memory";
import { registerAskHandler } from "./handlers/ask";

interface BotEnv {
  DISCORD_BOT_TOKEN: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APPLICATION_ID: string;
  OPENROUTER_API_KEY: string;
}

export function createBot(env: BotEnv) {
  const bot = new Chat({
    userName: "lapidary-ask",
    adapters: {
      discord: createDiscordAdapter({
        botToken: env.DISCORD_BOT_TOKEN,
        publicKey: env.DISCORD_PUBLIC_KEY,
        applicationId: env.DISCORD_APPLICATION_ID,
      }),
    },
    state: createMemoryState(),
  });

  registerAskHandler(bot, env);

  return bot;
}
