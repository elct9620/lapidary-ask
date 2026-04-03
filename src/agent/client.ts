import {
  generateText,
  stepCountIs,
  type LanguageModel,
  type TelemetryIntegration,
} from "ai";
import type {
  GoogleGenerativeAIProvider,
  GoogleLanguageModelOptions,
} from "@ai-sdk/google";
import type { OpenRouterProvider } from "@openrouter/ai-sdk-provider";
import { buildSystemPrompt, DEFAULT_LOCALE } from "./prompt";
import type { Tools } from "./tools";
import { buildTelemetryConfig } from "./telemetry-helpers";
import {
  DEFAULT_AI_STUDIO_ASK_MODEL,
  DEFAULT_OPENROUTER_ASK_MODEL,
} from "../models";

export interface AskLLMOptions {
  question: string;
  openrouter: OpenRouterProvider;
  google?: GoogleGenerativeAIProvider;
  openrouterModel?: string;
  aiStudioModel?: string;
  tools: Tools;
  locale?: string;
  integrations?: TelemetryIntegration[];
}

async function generateWithModel(
  model: LanguageModel,
  options: {
    system: string;
    prompt: string;
    tools: Tools;
    integrations?: TelemetryIntegration[];
    providerOptions?: { google: GoogleLanguageModelOptions };
  },
): Promise<string> {
  const { text } = await generateText({
    model,
    system: options.system,
    prompt: options.prompt,
    tools: options.tools,
    stopWhen: stepCountIs(15),
    ...buildTelemetryConfig(options.integrations),
    ...(options.providerOptions
      ? { providerOptions: options.providerOptions }
      : {}),
  });
  return text || "No response.";
}

export async function askLLM(options: AskLLMOptions): Promise<string> {
  const {
    question,
    openrouter,
    google,
    openrouterModel = DEFAULT_OPENROUTER_ASK_MODEL,
    aiStudioModel = DEFAULT_AI_STUDIO_ASK_MODEL,
    tools,
    locale = DEFAULT_LOCALE,
    integrations,
  } = options;

  const system = buildSystemPrompt(locale);
  const shared = { system, prompt: question, tools, integrations };

  if (!google) {
    return generateWithModel(openrouter(openrouterModel), shared);
  }

  try {
    return await generateWithModel(google(aiStudioModel), {
      ...shared,
      providerOptions: {
        google: {
          thinkingConfig: { thinkingLevel: "medium" },
        },
      },
    });
  } catch {
    return generateWithModel(openrouter(openrouterModel), shared);
  }
}
