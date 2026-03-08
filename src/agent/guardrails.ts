import { generateText, Output } from "ai";
import type { TelemetryIntegration } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";
import { getLanguageName } from "./prompt";
import { buildTelemetryConfig } from "./telemetry-helpers";

export interface CheckGuardrailsOptions {
  question: string;
  apiKey: string;
  locale?: string;
  integrations?: TelemetryIntegration[];
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

function buildGuardrailsSystemPrompt(locale: string): string {
  const language = getLanguageName(locale);

  return `You are a relevance classifier for the Lapidary Knowledge Graph assistant.

The Lapidary Knowledge Graph contains information about:
- **Rubyists**: Ruby community members identified by their bugs.ruby-lang.org usernames.
- **CoreModules**: Built-in Ruby modules (e.g., String, Array, IO).
- **Stdlibs**: Standard libraries shipped with Ruby (e.g., json, net/http).
- **Relationships**: Maintenance and Contribute relationships between Rubyists and modules/libraries, inferred from Ruby Issue Tracker activity.

Your task: Determine whether the user's question is related to the Lapidary Knowledge Graph's scope.

A question is **relevant** if it asks about:
- Rubyists and their contributions or maintenance roles
- Ruby core modules or standard libraries and who maintains/contributes to them
- Relationships between Rubyists and Ruby modules/libraries
- General questions about a Ruby module or library that can be answered with maintainer/contributor information (e.g., "Tell me about rdoc", "What is net/http?")

A question is **irrelevant** if it is about:
- Topics unrelated to Ruby or its ecosystem
- Requests for code examples, implementation help, or programming tutorials (e.g., "How do I use Array?", "Give me an rdoc example")
- General programming questions not related to Ruby module/library maintainers
- Requests unrelated to the knowledge graph data

When in doubt about whether a question asks about maintainers/contributors vs. code implementation, classify as **relevant** — the downstream assistant will handle scoping.

Respond with:
- \`relevant: true\` and an empty \`reason\` if the question is relevant.
- \`relevant: false\` and a brief \`reason\` explaining why it is not relevant.

Always respond the reason in **${language}**.`;
}

export async function checkGuardrails(
  options: CheckGuardrailsOptions,
): Promise<GuardrailsResult> {
  try {
    const { question, apiKey, locale = "zh-TW", integrations } = options;
    const openrouter = createOpenRouter({ apiKey });

    const { output } = await generateText({
      model: openrouter("openrouter/free"),
      output: Output.object({ schema: guardrailsSchema }),
      system: buildGuardrailsSystemPrompt(locale),
      prompt: question,
      ...buildTelemetryConfig(integrations),
    });

    return output ?? FAIL_OPEN;
  } catch {
    return FAIL_OPEN;
  }
}
