import { describe, it, expect, vi } from "vitest";
import { SYSTEM_PROMPT } from "../src/agent/prompt";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: vi.fn(),
    stepCountIs: vi.fn((n: number) => `stepCountIs(${n})`),
  };
});

vi.mock("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter: vi.fn(() => vi.fn((model: string) => `model:${model}`)),
}));

import { askLLM } from "../src/agent/client";
import { generateText } from "ai";

const mockedGenerateText = vi.mocked(generateText);

describe("askLLM", () => {
  const mockFetcher = { fetch: vi.fn() } as unknown as Fetcher;

  it("returns LLM text on success", async () => {
    mockedGenerateText.mockResolvedValue({
      text: "Hello from LLM",
    } as Awaited<ReturnType<typeof generateText>>);

    const result = await askLLM(
      "What is Ruby?",
      "test-key",
      mockFetcher,
      "http://api.test",
    );

    expect(result).toBe("Hello from LLM");
  });

  it('returns "No response." when text is empty', async () => {
    mockedGenerateText.mockResolvedValue({
      text: "",
    } as Awaited<ReturnType<typeof generateText>>);

    const result = await askLLM(
      "What is Ruby?",
      "test-key",
      mockFetcher,
      "http://api.test",
    );

    expect(result).toBe("No response.");
  });

  it("passes correct parameters to generateText", async () => {
    mockedGenerateText.mockResolvedValue({
      text: "response",
    } as Awaited<ReturnType<typeof generateText>>);

    await askLLM("test question", "test-key", mockFetcher, "http://api.test");

    expect(mockedGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: SYSTEM_PROMPT,
        prompt: "test question",
        stopWhen: "stepCountIs(15)",
      }),
    );
  });
});
