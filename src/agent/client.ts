import { generateText, stepCountIs } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { buildSystemPrompt } from "./prompt";
import { createTools } from "./tools";

export async function askLLM(
  question: string,
  apiKey: string,
  internalApi: Fetcher,
  internalApiUrl: string,
  locale: string = "zh-TW",
): Promise<string> {
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
