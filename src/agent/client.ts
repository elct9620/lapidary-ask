import { generateText, stepCountIs } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { buildSystemPrompt } from "./prompt";
import { createTools } from "./tools";

export interface AskLLMOptions {
  question: string;
  apiKey: string;
  internalApi: Fetcher;
  internalApiUrl: string;
  locale?: string;
}

export async function askLLM(options: AskLLMOptions): Promise<string> {
  const {
    question,
    apiKey,
    internalApi,
    internalApiUrl,
    locale = "zh-TW",
  } = options;
  const openrouter = createOpenRouter({ apiKey });
  const tools = createTools(internalApi, internalApiUrl);
  const { text } = await generateText({
    model: openrouter("openrouter/free"),
    system: buildSystemPrompt(locale),
    prompt: question,
    tools,
    stopWhen: stepCountIs(15),
  });
  return text || "No response.";
}
