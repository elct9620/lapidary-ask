import { Hono } from "hono";
import { handleDiscordWebhook } from "./discord";

export { AskWorkflow } from "./workflows/ask";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => {
  return c.json({ status: "ok" });
});

app.post("/api/webhooks/discord", async (c) => {
  return handleDiscordWebhook(c.req.raw, c.executionCtx);
});

export default app;
