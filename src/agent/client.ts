import { generateText, stepCountIs, type TelemetryIntegration } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { buildSystemPrompt } from "./prompt";
import { createTools } from "./tools";
import type { Flushable } from "../telemetry/langfuse";
import { buildTelemetryConfig, flushIntegrations } from "./telemetry-helpers";

export interface AskLLMOptions {
  question: string;
  apiKey: string;
  internalApi: Fetcher;
  internalApiUrl: string;
  locale?: string;
  integrations?: (TelemetryIntegration & Flushable)[];
}

export async function askLLM(options: AskLLMOptions): Promise<string> {
  const {
    question,
    apiKey,
    internalApi,
    internalApiUrl,
    locale = "zh-TW",
    integrations,
  } = options;
  const openrouter = createOpenRouter({ apiKey });
  const tools = createTools(internalApi, internalApiUrl);
  try {
    const { text } = await generateText({
      model: openrouter("openrouter/free"),
      system: buildSystemPrompt(locale),
      prompt: question,
      tools,
      stopWhen: stepCountIs(15),
      ...buildTelemetryConfig(integrations),
    });
    return text || "No response.";
  } catch (error) {
    await flushIntegrations(integrations);
    throw error;
  }
}
