import { Hono } from "hono";
import { createTracerProvider } from "@aotoki/edge-otel";
import { langfuseExporter } from "@aotoki/edge-otel/exporters/langfuse";
import { createHonoMiddleware } from "@aotoki/edge-otel/middleware/hono";
import { handleDiscordWebhook } from "./discord";

export { AskWorkflow } from "./workflows/ask";

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
  if (!c.env?.LANGFUSE_PUBLIC_KEY || !c.env?.LANGFUSE_SECRET_KEY) {
    return next();
  }

  const exporter = langfuseExporter({
    publicKey: c.env.LANGFUSE_PUBLIC_KEY,
    secretKey: c.env.LANGFUSE_SECRET_KEY,
    baseUrl: c.env.LANGFUSE_BASE_URL || undefined,
    environment: c.env.ENVIRONMENT || undefined,
  });
  const provider = createTracerProvider({
    ...exporter,
    serviceName: "ruby-lapidary-ask",
  });
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
