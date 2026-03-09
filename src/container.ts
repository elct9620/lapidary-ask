import { env } from "cloudflare:workers";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createTools } from "./agent/tools";
import { patchDiscordResponse } from "./discord/api";
import { createTelemetryContext } from "./telemetry/context";
import { createLangfuseClient } from "./telemetry/client";

export function createContainer() {
  const openrouter = createOpenRouter({ apiKey: env.OPENROUTER_API_KEY });
  const tools = createTools(env.INTERNAL_API, env.INTERNAL_API_URL);

  return {
    openrouter,
    tools,
    discordPublicKey: env.DISCORD_PUBLIC_KEY,
    askWorkflow: env.ASK_WORKFLOW,
    patchDiscordResponse: (
      token: string,
      payload: Parameters<typeof patchDiscordResponse>[2],
    ) => patchDiscordResponse(env.DISCORD_APPLICATION_ID, token, payload),
    createTelemetryContext: (
      opts?: Parameters<typeof createTelemetryContext>[1],
    ) => createTelemetryContext(env, opts),
    createLangfuseClient: () =>
      env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY
        ? createLangfuseClient(env)
        : null,
  };
}

export type AppContainer = ReturnType<typeof createContainer>;
