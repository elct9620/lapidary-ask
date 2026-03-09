import { generateText, stepCountIs, type TelemetryIntegration } from "ai";
import type { OpenRouterProvider } from "@openrouter/ai-sdk-provider";
import { buildSystemPrompt, DEFAULT_LOCALE } from "./prompt";
import type { Tools } from "./tools";
import { buildTelemetryConfig } from "./telemetry-helpers";

export interface AskLLMOptions {
  question: string;
  openrouter: OpenRouterProvider;
  tools: Tools;
  locale?: string;
  integrations?: TelemetryIntegration[];
}

export async function askLLM(options: AskLLMOptions): Promise<string> {
  const {
    question,
    openrouter,
    tools,
    locale = DEFAULT_LOCALE,
    integrations,
  } = options;
  const { text } = await generateText({
    model: openrouter("openrouter/free"),
    system: buildSystemPrompt(locale),
    prompt: question,
    tools,
    stopWhen: stepCountIs(15),
    ...buildTelemetryConfig(integrations),
  });
  return text || "No response.";
}
