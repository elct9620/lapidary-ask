import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildSystemPrompt } from "../src/agent/prompt";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: vi.fn(),
    stepCountIs: vi.fn((n: number) => `stepCountIs(${n})`),
  };
});

import { askLLM } from "../src/agent/client";
import { generateText } from "ai";

const mockedGenerateText = vi.mocked(generateText);

const mockOpenrouter = vi.fn((model: string) => `model:${model}`) as any;
const mockGoogle = vi.fn((model: string) => `google:${model}`) as any;
const mockTools = {
  searchNodes: { execute: vi.fn() },
  getNeighbors: { execute: vi.fn() },
} as any;

describe("askLLM", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns LLM text on success", async () => {
    mockedGenerateText.mockResolvedValue({
      text: "Hello from LLM",
    } as Awaited<ReturnType<typeof generateText>>);

    const result = await askLLM({
      question: "What is Ruby?",
      openrouter: mockOpenrouter,
      tools: mockTools,
    });

    expect(result).toBe("Hello from LLM");
  });

  it('returns "No response." when text is empty', async () => {
    mockedGenerateText.mockResolvedValue({
      text: "",
    } as Awaited<ReturnType<typeof generateText>>);

    const result = await askLLM({
      question: "What is Ruby?",
      openrouter: mockOpenrouter,
      tools: mockTools,
    });

    expect(result).toBe("No response.");
  });

  it("uses openrouter model when google is not provided", async () => {
    mockedGenerateText.mockResolvedValue({
      text: "response",
    } as Awaited<ReturnType<typeof generateText>>);

    await askLLM({
      question: "test question",
      openrouter: mockOpenrouter,
      tools: mockTools,
    });

    expect(mockedGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "model:openrouter/free",
        system: buildSystemPrompt("zh-TW"),
        prompt: "test question",
        stopWhen: "stepCountIs(15)",
        tools: mockTools,
      }),
    );
  });

  it("uses google as primary provider when available", async () => {
    mockedGenerateText.mockResolvedValue({
      text: "response from google",
    } as Awaited<ReturnType<typeof generateText>>);

    const result = await askLLM({
      question: "test question",
      openrouter: mockOpenrouter,
      google: mockGoogle,
      tools: mockTools,
    });

    expect(result).toBe("response from google");
    expect(mockedGenerateText).toHaveBeenCalledTimes(1);
    expect(mockedGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "google:gemma-4-26b-a4b-it",
        providerOptions: {
          google: {
            thinkingConfig: { thinkingLevel: "medium" },
          },
        },
      }),
    );
  });

  it("falls back to openrouter when google fails", async () => {
    mockedGenerateText
      .mockRejectedValueOnce(new Error("Google API error"))
      .mockResolvedValueOnce({
        text: "fallback response",
      } as Awaited<ReturnType<typeof generateText>>);

    const result = await askLLM({
      question: "test question",
      openrouter: mockOpenrouter,
      google: mockGoogle,
      tools: mockTools,
    });

    expect(result).toBe("fallback response");
    expect(mockedGenerateText).toHaveBeenCalledTimes(2);
    expect(mockedGenerateText).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ model: "google:gemma-4-26b-a4b-it" }),
    );
    expect(mockedGenerateText).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ model: "model:openrouter/free" }),
    );
  });

  it("uses custom model names when provided", async () => {
    mockedGenerateText.mockResolvedValue({
      text: "response",
    } as Awaited<ReturnType<typeof generateText>>);

    await askLLM({
      question: "test question",
      openrouter: mockOpenrouter,
      google: mockGoogle,
      aiStudioModel: "gemma-4-31b-it",
      openrouterModel: "google/gemma-3-27b-it",
      tools: mockTools,
    });

    expect(mockedGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "google:gemma-4-31b-it",
      }),
    );
  });

  it("uses custom openrouter model when google is not provided", async () => {
    mockedGenerateText.mockResolvedValue({
      text: "response",
    } as Awaited<ReturnType<typeof generateText>>);

    await askLLM({
      question: "test question",
      openrouter: mockOpenrouter,
      openrouterModel: "google/gemma-3-27b-it",
      tools: mockTools,
    });

    expect(mockedGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "model:google/gemma-3-27b-it",
      }),
    );
  });

  it("passes experimental_telemetry when integrations provided", async () => {
    mockedGenerateText.mockResolvedValue({
      text: "response",
    } as Awaited<ReturnType<typeof generateText>>);

    const mockIntegration = { onStart: vi.fn() };

    await askLLM({
      question: "test question",
      openrouter: mockOpenrouter,
      tools: mockTools,
      integrations: [mockIntegration],
    });

    expect(mockedGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        experimental_telemetry: {
          isEnabled: true,
          integrations: [mockIntegration],
        },
      }),
    );
  });

  it("does not pass experimental_telemetry when no integrations", async () => {
    mockedGenerateText.mockResolvedValue({
      text: "response",
    } as Awaited<ReturnType<typeof generateText>>);

    await askLLM({
      question: "test question",
      openrouter: mockOpenrouter,
      tools: mockTools,
    });

    const call = mockedGenerateText.mock.calls[0][0];
    expect(call).not.toHaveProperty("experimental_telemetry");
  });

  it("passes locale to buildSystemPrompt", async () => {
    mockedGenerateText.mockResolvedValue({
      text: "response",
    } as Awaited<ReturnType<typeof generateText>>);

    await askLLM({
      question: "test question",
      openrouter: mockOpenrouter,
      tools: mockTools,
      locale: "ja",
    });

    expect(mockedGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: buildSystemPrompt("ja"),
      }),
    );
  });

  it("does not pass providerOptions when using openrouter only", async () => {
    mockedGenerateText.mockResolvedValue({
      text: "response",
    } as Awaited<ReturnType<typeof generateText>>);

    await askLLM({
      question: "test question",
      openrouter: mockOpenrouter,
      tools: mockTools,
    });

    const call = mockedGenerateText.mock.calls[0][0];
    expect(call).not.toHaveProperty("providerOptions");
  });
});
