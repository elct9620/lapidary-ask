import { env } from "cloudflare:workers";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createTools } from "./agent/tools";
import { patchDiscordResponse } from "./discord/api";
import { createTelemetryContext } from "./telemetry/context";
import { createLangfuseClient } from "./telemetry/client";

export interface ModelConfig {
  aiStudioAskModel: string;
  aiStudioGuardModel: string;
  openrouterAskModel: string;
  openrouterGuardModel: string;
}

export function createContainer() {
  const openrouter = createOpenRouter({ apiKey: env.OPENROUTER_API_KEY });
  const google = env.AI_STUDIO_API_KEY
    ? createGoogleGenerativeAI({ apiKey: env.AI_STUDIO_API_KEY })
    : undefined;
  const tools = createTools(env.INTERNAL_API, env.INTERNAL_API_URL);
  const modelConfig: ModelConfig = {
    aiStudioAskModel: env.AI_STUDIO_ASK_MODEL || "gemma-4-26b-a4b-it",
    aiStudioGuardModel: env.AI_STUDIO_GUARD_MODEL || "gemma-4-26b-a4b-it",
    openrouterAskModel: env.OPENROUTER_ASK_MODEL || "openrouter/free",
    openrouterGuardModel: env.OPENROUTER_GUARD_MODEL || "openrouter/free",
  };

  return {
    openrouter,
    google,
    modelConfig,
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
