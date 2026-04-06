import { env } from "cloudflare:workers";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createTools } from "./agent/tools";
import { patchDiscordResponse } from "./discord/api";
import { createLangfuseClient } from "./telemetry/client";
import { createLangfuseTracerProvider } from "./telemetry/provider";
import {
  DEFAULT_AI_STUDIO_ASK_MODEL,
  DEFAULT_AI_STUDIO_GUARD_MODEL,
  DEFAULT_OPENROUTER_ASK_MODEL,
  DEFAULT_OPENROUTER_GUARD_MODEL,
} from "./models";

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
    aiStudioAskModel: env.AI_STUDIO_ASK_MODEL || DEFAULT_AI_STUDIO_ASK_MODEL,
    aiStudioGuardModel:
      env.AI_STUDIO_GUARD_MODEL || DEFAULT_AI_STUDIO_GUARD_MODEL,
    openrouterAskModel:
      env.OPENROUTER_ASK_MODEL || DEFAULT_OPENROUTER_ASK_MODEL,
    openrouterGuardModel:
      env.OPENROUTER_GUARD_MODEL || DEFAULT_OPENROUTER_GUARD_MODEL,
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
    createTracerProvider: () => {
      if (!env.LANGFUSE_PUBLIC_KEY || !env.LANGFUSE_SECRET_KEY) return null;
      return createLangfuseTracerProvider({
        publicKey: env.LANGFUSE_PUBLIC_KEY,
        secretKey: env.LANGFUSE_SECRET_KEY,
        baseUrl: env.LANGFUSE_BASE_URL || undefined,
        environment: env.ENVIRONMENT || undefined,
      });
    },
    createLangfuseClient: () =>
      env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY
        ? createLangfuseClient(env)
        : null,
  };
}

export type AppContainer = ReturnType<typeof createContainer>;
