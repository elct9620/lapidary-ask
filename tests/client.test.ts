import { describe, it, expect, vi } from "vitest";
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
const mockTools = {
  searchNodes: { execute: vi.fn() },
  getNeighbors: { execute: vi.fn() },
} as any;

describe("askLLM", () => {
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

  it("passes correct parameters to generateText", async () => {
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
        system: buildSystemPrompt("zh-TW"),
        prompt: "test question",
        stopWhen: "stepCountIs(15)",
        tools: mockTools,
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
});
