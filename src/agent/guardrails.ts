import { generateText, Output } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";

export interface CheckGuardrailsOptions {
  question: string;
  apiKey: string;
}

export interface GuardrailsResult {
  relevant: boolean;
  reason: string;
}

const FAIL_OPEN: GuardrailsResult = { relevant: true, reason: "" };

const guardrailsSchema = z.object({
  relevant: z.boolean(),
  reason: z.string(),
});

const GUARDRAILS_SYSTEM_PROMPT = `You are a relevance classifier for the Lapidary Knowledge Graph assistant.

The Lapidary Knowledge Graph contains information about:
- **Rubyists**: Ruby community members identified by their bugs.ruby-lang.org usernames.
- **CoreModules**: Built-in Ruby modules (e.g., String, Array, IO).
- **Stdlibs**: Standard libraries shipped with Ruby (e.g., json, net/http).
- **Relationships**: Maintenance and Contribute relationships between Rubyists and modules/libraries, inferred from Ruby Issue Tracker activity.

Your task: Determine whether the user's question is related to the Lapidary Knowledge Graph's scope.

A question is **relevant** if it asks about:
- Rubyists and their contributions or maintenance roles
- Ruby core modules or standard libraries
- Relationships between Rubyists and Ruby modules/libraries

A question is **irrelevant** if it is about:
- Topics unrelated to Ruby or its ecosystem
- General programming questions not specific to Ruby core/stdlib relationships
- Requests unrelated to the knowledge graph data

Respond with:
- \`relevant: true\` and an empty \`reason\` if the question is relevant.
- \`relevant: false\` and a brief \`reason\` explaining why it is not relevant.`;

export async function checkGuardrails(
  options: CheckGuardrailsOptions,
): Promise<GuardrailsResult> {
  try {
    const { question, apiKey } = options;
    const openrouter = createOpenRouter({ apiKey });

    const { output } = await generateText({
      model: openrouter("openrouter/free"),
      output: Output.object({ schema: guardrailsSchema }),
      system: GUARDRAILS_SYSTEM_PROMPT,
      prompt: question,
    });

    return output ?? FAIL_OPEN;
  } catch {
    return FAIL_OPEN;
  }
}
