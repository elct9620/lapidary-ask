import { generateText, Output, type LanguageModel } from "ai";
import type { Tracer } from "@opentelemetry/api";
import type { GoogleGenerativeAIProvider } from "@ai-sdk/google";
import type { OpenRouterProvider } from "@openrouter/ai-sdk-provider";
import { z } from "zod";
import { getLanguageName, DEFAULT_LOCALE, DOMAIN_DEFINITIONS } from "./prompt";
import { withGoogleFallback } from "./provider-fallback";
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
  tracer?: Tracer;
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

  return `## Goal

Determine whether the user's question is within the scope of the Lapidary Knowledge Graph.

## Constitution & Guardrails

- When in doubt about whether a question asks about maintainers/contributors vs. code implementation, classify as **relevant** — the downstream assistant will handle scoping.
- Always write the reason in **${language}**.

## Domain Knowledge

The Lapidary Knowledge Graph contains information about:
${DOMAIN_DEFINITIONS}
- **Relationships**: Maintenance and Contribute relationships between Rubyists and modules/libraries, inferred from Ruby Issue Tracker activity.
- **Indirect relationships**: Rubyist-to-Rubyist relationships can be inferred through shared module maintenance/contribution.

### Relevant Questions

A question is **relevant** if it asks about:
- Rubyists and their contributions or maintenance roles
- Ruby core modules or standard libraries and who maintains/contributes to them
- Relationships between Rubyists and Ruby modules/libraries
- General questions about a Ruby module or library that can be answered with maintainer/contributor information (e.g., "Tell me about rdoc", "What is net/http?")
- Indirect relationships between Rubyists inferred through shared module maintenance/contribution (e.g., "Has A collaborated with B?", "Who has matz worked with?")
- Indirect or colloquial questions that can be mapped to knowledge graph queries (e.g., "matz 跟誰一起工作過?" → co-contributors)

### Irrelevant Questions

A question is **irrelevant** if it is about:
- Topics unrelated to Ruby or its ecosystem
- Requests for code examples, implementation help, or programming tutorials (e.g., "How do I use Array?", "Give me an rdoc example")
- General programming questions not related to Ruby module/library maintainers
- Requests unrelated to the knowledge graph data

## Workflow

Analyze the question step by step in the \`reasoning\` field:

<workflow>
  <step name="topic-identification">Identify the subject the user is asking about.</step>
  <step name="intent-interpretation">Interpret what the user actually wants to know. Consider that vague or colloquial phrasing may map to knowledge graph queries:
    - "Who does X work with?" → co-contributors sharing modules with X
    - "What's happening with Y?" / "Y 的近況" → recent activity or relationships for Y
    - Terms that are not exact module names may refer to related modules (e.g., "ReDOS" → Regexp module, "HTTP" → net/http)
  </step>
  <step name="domain-check">Determine if this intent can be answered using Rubyist–module/library relationships, including indirect Rubyist-to-Rubyist relationships inferred through shared modules.</step>
  <step name="final-decision">Make the relevance decision.</step>
</workflow>

## Output Format

<schema>
- \`reasoning\`: Step-by-step analysis following the workflow above.
- \`relevant\`: \`true\` if the question is within scope, \`false\` otherwise.
- \`reason\`: Empty string if relevant. Brief explanation in ${language} if not relevant.
</schema>

## Error Handling

- If the question is ambiguous or borderline, default to \`relevant: true\`.
- If the question mixes relevant and irrelevant parts, classify based on the primary intent.`;
}

async function generateGuardrails(
  model: LanguageModel,
  system: string,
  question: string,
  tracer?: Tracer,
): Promise<GuardrailsResult> {
  const { output } = await generateText({
    model,
    output: Output.object({ schema: guardrailsSchema }),
    system,
    prompt: question,
    ...(tracer ? { experimental_telemetry: { isEnabled: true, tracer } } : {}),
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
      tracer,
    } = options;

    const system = buildGuardrailsSystemPrompt(locale);

    return await withGoogleFallback({
      google,
      openrouter,
      aiStudioModel,
      openrouterModel,
      label: "AI Studio guardrails",
      run: (model) => generateGuardrails(model, system, question, tracer),
    });
  } catch (error) {
    console.warn("Guardrails check failed entirely, failing open", error);
    return FAIL_OPEN;
  }
}
