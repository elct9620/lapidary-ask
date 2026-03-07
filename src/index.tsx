import { Hono } from "hono";
import { env } from "cloudflare:workers";
import { Chat } from "chat";
import { createDiscordAdapter } from "./adapter/discord";
import { createMemoryState } from "@chat-adapter/state-memory";
import { askLLM } from "./llm";
import { getStringOption } from "./discord-helpers";

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

const app = new Hono();

app.get("/", (c) => {
  return c.json({ status: "ok" });
});

app.post("/api/webhooks/discord", async (c) => {
  return bot.webhooks.discord(c.req.raw, {
    waitUntil: c.executionCtx.waitUntil.bind(c.executionCtx),
  });
});

export default app;
