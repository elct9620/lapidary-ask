import { askLLM } from "../agent";
import { getStringOption } from "../adapter/discord";

interface AskHandlerEnv {
  OPENROUTER_API_KEY: string;
  INTERNAL_API: Fetcher;
  INTERNAL_API_URL: string;
}

export function registerAskHandler(
  bot: {
    onSlashCommand: (
      command: string,
      handler: (event: any) => Promise<void>,
    ) => void;
  },
  env: AskHandlerEnv,
) {
  bot.onSlashCommand("/ask", async (event) => {
    const question = getStringOption(event.raw, "question");
    if (!question) {
      await event.channel.post({ markdown: "Please provide a question." });
      return;
    }

    const answer = await askLLM(
      question,
      env.OPENROUTER_API_KEY,
      env.INTERNAL_API,
      env.INTERNAL_API_URL,
    );
    await event.channel.post({
      markdown: answer,
    });
  });
}
