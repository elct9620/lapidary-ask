import { generateText, stepCountIs, type TelemetryIntegration } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { buildSystemPrompt } from "./prompt";
import { createTools } from "./tools";

interface Flushable {
  flush(): Promise<void>;
}

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
      ...(integrations && {
        experimental_telemetry: { isEnabled: true, integrations },
      }),
    });
    return text || "No response.";
  } catch (error) {
    if (integrations) {
      await Promise.allSettled(integrations.map((i) => i.flush()));
    }
    throw error;
  }
}
