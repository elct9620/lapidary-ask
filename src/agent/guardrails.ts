import { generateText, Output, type LanguageModel } from "ai";
import type { TelemetryIntegration } from "ai";
import type { GoogleGenerativeAIProvider } from "@ai-sdk/google";
import type { OpenRouterProvider } from "@openrouter/ai-sdk-provider";
import { z } from "zod";
import { getLanguageName, DEFAULT_LOCALE, DOMAIN_DEFINITIONS } from "./prompt";
import { buildTelemetryConfig } from "./telemetry-helpers";
import {
  DEFAULT_AI_STUDIO_GUARD_MODEL,
  DEFAULT_OPENROUTER_GUARD_MODEL,
} from "../models";

export interface CheckGuardrailsOptions {
  question: string;
  openrouter: OpenRouterProvider;
  google?: GoogleGenerativeAIProvider;
  openrouterModel?: string;
  aiStudioModel?: string;
  locale?: string;
  integrations?: TelemetryIntegration[];
}

export interface GuardrailsResult {
  reasoning: string;
  relevant: boolean;
  reason: string;
}

const FAIL_OPEN: GuardrailsResult = {
  reasoning: "",
  relevant: true,
  reason: "",
};

const guardrailsSchema = z.object({
  reasoning: z
    .string()
    .describe(
      "Step-by-step analysis of the user's intent before making a relevance decision.",
    ),
  relevant: z.boolean(),
  reason: z.string(),
});

function buildGuardrailsSystemPrompt(locale: string): string {
  const language = getLanguageName(locale);

  return `You are a relevance classifier for the Lapidary Knowledge Graph assistant.

The Lapidary Knowledge Graph contains information about:
${DOMAIN_DEFINITIONS}
- **Relationships**: Maintenance and Contribute relationships between Rubyists and modules/libraries, inferred from Ruby Issue Tracker activity.

Your task: Determine whether the user's question is related to the Lapidary Knowledge Graph's scope.

## Classification Steps

Before deciding, analyze the question step by step in the \`reasoning\` field:

1. **Topic identification**: What subject is the user asking about?
2. **Intent interpretation**: What does the user actually want to know? Consider that vague or colloquial phrasing may map to knowledge graph queries:
   - "Who does X work with?" → co-contributors sharing modules with X
   - "What's happening with Y?" / "Y 的近況" → recent activity or relationships for Y
   - Terms that are not exact module names may refer to related modules (e.g., "ReDOS" → Regexp module, "HTTP" → net/http)
3. **Domain check**: Can this intent be answered using Rubyist–module/library relationships, including indirect Rubyist-to-Rubyist relationships inferred through shared modules?
4. **Final decision**: Is the question relevant?

## Relevant Questions

A question is **relevant** if it asks about:
- Rubyists and their contributions or maintenance roles
- Ruby core modules or standard libraries and who maintains/contributes to them
- Relationships between Rubyists and Ruby modules/libraries
- General questions about a Ruby module or library that can be answered with maintainer/contributor information (e.g., "Tell me about rdoc", "What is net/http?")
- Indirect relationships between Rubyists inferred through shared module maintenance/contribution (e.g., "Has A collaborated with B?", "Who has matz worked with?")
- Indirect or colloquial questions that can be mapped to knowledge graph queries (e.g., "matz 跟誰一起工作過?" → co-contributors)

## Irrelevant Questions

A question is **irrelevant** if it is about:
- Topics unrelated to Ruby or its ecosystem
- Requests for code examples, implementation help, or programming tutorials (e.g., "How do I use Array?", "Give me an rdoc example")
- General programming questions not related to Ruby module/library maintainers
- Requests unrelated to the knowledge graph data

When in doubt about whether a question asks about maintainers/contributors vs. code implementation, classify as **relevant** — the downstream assistant will handle scoping.

## Response Format

- \`reasoning\`: Your step-by-step analysis following the classification steps above.
- \`relevant: true\` and an empty \`reason\` if the question is relevant.
- \`relevant: false\` and a brief \`reason\` explaining why it is not relevant.

Always respond the reason in **${language}**.`;
}

async function generateGuardrails(
  model: LanguageModel,
  system: string,
  question: string,
  integrations?: TelemetryIntegration[],
): Promise<GuardrailsResult> {
  const { output } = await generateText({
    model,
    output: Output.object({ schema: guardrailsSchema }),
    system,
    prompt: question,
    ...buildTelemetryConfig(integrations),
  });

  return output ?? FAIL_OPEN;
}

export async function checkGuardrails(
  options: CheckGuardrailsOptions,
): Promise<GuardrailsResult> {
  try {
    const {
      question,
      openrouter,
      google,
      openrouterModel = DEFAULT_OPENROUTER_GUARD_MODEL,
      aiStudioModel = DEFAULT_AI_STUDIO_GUARD_MODEL,
      locale = DEFAULT_LOCALE,
      integrations,
    } = options;

    const system = buildGuardrailsSystemPrompt(locale);

    if (!google) {
      return await generateGuardrails(
        openrouter(openrouterModel),
        system,
        question,
        integrations,
      );
    }

    try {
      return await generateGuardrails(
        google(aiStudioModel),
        system,
        question,
        integrations,
      );
    } catch {
      return await generateGuardrails(
        openrouter(openrouterModel),
        system,
        question,
        integrations,
      );
    }
  } catch {
    return FAIL_OPEN;
  }
}
