import { Hono } from "hono";
import { env } from "cloudflare:workers";
import { createBot } from "./bot";

const bot = createBot(env);

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
