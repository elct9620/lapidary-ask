import { Hono } from "hono";
import { createHonoMiddleware } from "@aotoki/edge-otel/middleware/hono";
import { handleDiscordWebhook } from "./discord";
import { createContainer } from "./container";

export { AskWorkflow } from "./workflows/ask";

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
  const container = createContainer();
  const provider = container.createTracerProvider();
  if (!provider) return next();

  const middleware = createHonoMiddleware(provider);
  return middleware(c, next);
});

app.get("/", (c) => {
  return c.json({ status: "ok" });
});

app.post("/api/webhooks/discord", async (c) => {
  return handleDiscordWebhook(c.req.raw, c.executionCtx);
});

export default app;
