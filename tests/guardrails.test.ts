import { describe, it, expect, vi } from "vitest";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: vi.fn(),
  };
});

vi.mock("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter: vi.fn(() => vi.fn((model: string) => `model:${model}`)),
}));

import { checkGuardrails } from "../src/agent/guardrails";
import { generateText, Output } from "ai";

const mockedGenerateText = vi.mocked(generateText);

describe("checkGuardrails", () => {
  it("returns relevant: true for related questions", async () => {
    mockedGenerateText.mockResolvedValue({
      output: { relevant: true, reason: "" },
    } as Awaited<ReturnType<typeof generateText>>);

    const result = await checkGuardrails({
      question: "Who maintains the String module?",
      apiKey: "test-key",
    });

    expect(result).toEqual({ relevant: true, reason: "" });
  });

  it("returns relevant: false with reason for unrelated questions", async () => {
    mockedGenerateText.mockResolvedValue({
      output: {
        relevant: false,
        reason: "This question is about cooking, not Ruby.",
      },
    } as Awaited<ReturnType<typeof generateText>>);

    const result = await checkGuardrails({
      question: "How do I cook pasta?",
      apiKey: "test-key",
    });

    expect(result).toEqual({
      relevant: false,
      reason: "This question is about cooking, not Ruby.",
    });
  });

  it("fail-opens when generateText throws an error", async () => {
    mockedGenerateText.mockRejectedValue(new Error("API error"));

    const result = await checkGuardrails({
      question: "test question",
      apiKey: "test-key",
    });

    expect(result).toEqual({ relevant: true, reason: "" });
  });

  it("fail-opens when output is null", async () => {
    mockedGenerateText.mockResolvedValue({
      output: null,
    } as Awaited<ReturnType<typeof generateText>>);

    const result = await checkGuardrails({
      question: "test question",
      apiKey: "test-key",
    });

    expect(result).toEqual({ relevant: true, reason: "" });
  });

  it("includes language instruction in system prompt when locale is provided", async () => {
    mockedGenerateText.mockResolvedValue({
      output: { relevant: false, reason: "..." },
    } as Awaited<ReturnType<typeof generateText>>);

    await checkGuardrails({
      question: "How do I cook pasta?",
      apiKey: "test-key",
      locale: "ja",
    });

    expect(mockedGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining("Japanese"),
      }),
    );
  });

  it("uses default locale zh-TW when locale is not provided", async () => {
    mockedGenerateText.mockResolvedValue({
      output: { relevant: true, reason: "" },
    } as Awaited<ReturnType<typeof generateText>>);

    await checkGuardrails({
      question: "Who maintains String?",
      apiKey: "test-key",
    });

    expect(mockedGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining("Traditional Chinese (Taiwan)"),
      }),
    );
  });

  it("passes correct parameters to generateText", async () => {
    mockedGenerateText.mockResolvedValue({
      output: { relevant: true, reason: "" },
    } as Awaited<ReturnType<typeof generateText>>);

    await checkGuardrails({
      question: "Who maintains String?",
      apiKey: "test-key",
    });

    expect(mockedGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "model:openrouter/free",
        output: expect.anything(),
        prompt: "Who maintains String?",
        system: expect.stringContaining("Lapidary Knowledge Graph"),
      }),
    );
  });

  it("passes integrations to generateText when provided", async () => {
    mockedGenerateText.mockResolvedValue({
      output: { relevant: true, reason: "" },
    } as Awaited<ReturnType<typeof generateText>>);

    const mockIntegration = { flush: vi.fn().mockResolvedValue(undefined) };

    await checkGuardrails({
      question: "Who maintains String?",
      apiKey: "test-key",
      integrations: [mockIntegration as any],
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

  it("does not include experimental_telemetry when no integrations", async () => {
    mockedGenerateText.mockResolvedValue({
      output: { relevant: true, reason: "" },
    } as Awaited<ReturnType<typeof generateText>>);

    await checkGuardrails({
      question: "Who maintains String?",
      apiKey: "test-key",
    });

    expect(mockedGenerateText).toHaveBeenCalledWith(
      expect.not.objectContaining({
        experimental_telemetry: expect.anything(),
      }),
    );
  });
});
