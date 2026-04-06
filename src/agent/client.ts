import { generateText, stepCountIs, type LanguageModel } from "ai";
import type {
  GoogleGenerativeAIProvider,
  GoogleLanguageModelOptions,
} from "@ai-sdk/google";
import type { OpenRouterProvider } from "@openrouter/ai-sdk-provider";
import type { Tracer } from "@opentelemetry/api";
import { buildSystemPrompt, DEFAULT_LOCALE } from "./prompt";
import type { Tools } from "./tools";
import { withGoogleFallback } from "./provider-fallback";
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
  tracer?: Tracer;
}

async function generateWithModel(
  model: LanguageModel,
  options: {
    system: string;
    prompt: string;
    tools: Tools;
    tracer?: Tracer;
    providerOptions?: { google: GoogleLanguageModelOptions };
  },
): Promise<string> {
  const { text } = await generateText({
    model,
    system: options.system,
    prompt: options.prompt,
    tools: options.tools,
    stopWhen: stepCountIs(30),
    ...(options.tracer
      ? { experimental_telemetry: { isEnabled: true, tracer: options.tracer } }
      : {}),
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
    tracer,
  } = options;

  const system = buildSystemPrompt(locale);
  const shared = { system, prompt: question, tools, tracer };

  return withGoogleFallback({
    google,
    openrouter,
    aiStudioModel,
    openrouterModel,
    label: "AI Studio request",
    run: (model) => generateWithModel(model, shared),
    runWithGoogle: (model) =>
      generateWithModel(model, {
        ...shared,
        providerOptions: {
          google: {
            thinkingConfig: { thinkingLevel: "high" },
          },
        },
      }),
  });
}
