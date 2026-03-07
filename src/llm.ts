import { generateText, stepCountIs } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { tools } from "./tools";

const SYSTEM_PROMPT = `你是一個友善的 AI 助手。請使用繁體中文回答問題。`;

export async function askLLM(
  question: string,
  apiKey: string,
): Promise<string> {
  const openrouter = createOpenRouter({ apiKey });
  const { text } = await generateText({
    model: openrouter("openrouter/auto"),
    system: SYSTEM_PROMPT,
    prompt: question,
    tools,
    stopWhen: stepCountIs(5),
  });
  return text || "No response.";
}
