import type { LanguageModel } from "ai";
import type { GoogleGenerativeAIProvider } from "@ai-sdk/google";
import type { OpenRouterProvider } from "@openrouter/ai-sdk-provider";

export interface FallbackOptions<T> {
  google?: GoogleGenerativeAIProvider;
  openrouter: OpenRouterProvider;
  aiStudioModel: string;
  openrouterModel: string;
  label: string;
  run: (model: LanguageModel) => Promise<T>;
  runWithGoogle?: (model: LanguageModel) => Promise<T>;
}

export async function withGoogleFallback<T>(
  options: FallbackOptions<T>,
): Promise<T> {
  const {
    google,
    openrouter,
    aiStudioModel,
    openrouterModel,
    label,
    run,
    runWithGoogle,
  } = options;

  if (!google) {
    return run(openrouter(openrouterModel));
  }

  try {
    return await (runWithGoogle ?? run)(google(aiStudioModel));
  } catch (error) {
    console.warn(`${label} failed, falling back to OpenRouter`, error);
    return run(openrouter(openrouterModel));
  }
}
