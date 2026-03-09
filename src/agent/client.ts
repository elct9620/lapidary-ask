import { generateText, stepCountIs, type TelemetryIntegration } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { buildSystemPrompt, DEFAULT_LOCALE } from "./prompt";
import { createTools } from "./tools";
import { buildTelemetryConfig } from "./telemetry-helpers";

export interface AskLLMOptions {
  question: string;
  apiKey: string;
  internalApi: Fetcher;
  internalApiUrl: string;
  locale?: string;
  integrations?: TelemetryIntegration[];
}

export async function askLLM(options: AskLLMOptions): Promise<string> {
  const {
    question,
    apiKey,
    internalApi,
    internalApiUrl,
    locale = DEFAULT_LOCALE,
    integrations,
  } = options;
  const openrouter = createOpenRouter({ apiKey });
  const tools = createTools(internalApi, internalApiUrl);
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
