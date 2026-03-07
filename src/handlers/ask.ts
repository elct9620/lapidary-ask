import { askLLM } from "../agent";
import { getStringOption } from "../adapter/discord";

interface AskHandlerEnv {
  OPENROUTER_API_KEY: string;
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

    const answer = await askLLM(question, env.OPENROUTER_API_KEY);
    await event.channel.post({
      markdown: `**Question**\n\n> ${question}\n\n${answer}`,
    });
  });
}
