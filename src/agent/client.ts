import { generateText, stepCountIs } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { SYSTEM_PROMPT } from "./prompt";
import { tools } from "./tools";

export async function askLLM(
  question: string,
  apiKey: string,
): Promise<string> {
  const openrouter = createOpenRouter({ apiKey });
  const { text } = await generateText({
    model: openrouter("openrouter/free"),
    system: SYSTEM_PROMPT,
    prompt: question,
    tools,
    stopWhen: stepCountIs(5),
  });
  return text || "No response.";
}
