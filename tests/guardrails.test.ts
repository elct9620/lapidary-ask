import { describe, it, expect, vi } from "vitest";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: vi.fn(),
  };
});

import { checkGuardrails } from "../src/agent/guardrails";
import { generateText } from "ai";

const mockedGenerateText = vi.mocked(generateText);

const mockOpenrouter = vi.fn((model: string) => `model:${model}`) as any;

describe("checkGuardrails", () => {
  it("returns relevant: true for related questions", async () => {
    mockedGenerateText.mockResolvedValue({
      output: { relevant: true, reason: "" },
    } as Awaited<ReturnType<typeof generateText>>);

    const result = await checkGuardrails({
      question: "Who maintains the String module?",
      openrouter: mockOpenrouter,
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
      openrouter: mockOpenrouter,
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
      openrouter: mockOpenrouter,
    });

    expect(result).toEqual({ relevant: true, reason: "" });
  });

  it("fail-opens when output is null", async () => {
    mockedGenerateText.mockResolvedValue({
      output: null,
    } as Awaited<ReturnType<typeof generateText>>);

    const result = await checkGuardrails({
      question: "test question",
      openrouter: mockOpenrouter,
    });

    expect(result).toEqual({ relevant: true, reason: "" });
  });

  it("includes language instruction in system prompt when locale is provided", async () => {
    mockedGenerateText.mockResolvedValue({
      output: { relevant: false, reason: "..." },
    } as Awaited<ReturnType<typeof generateText>>);

    await checkGuardrails({
      question: "How do I cook pasta?",
      openrouter: mockOpenrouter,
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
      openrouter: mockOpenrouter,
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
      openrouter: mockOpenrouter,
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
      openrouter: mockOpenrouter,
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

  it("system prompt includes lenient classification guidance for borderline questions", async () => {
    mockedGenerateText.mockResolvedValue({
      output: { relevant: true, reason: "" },
    } as Awaited<ReturnType<typeof generateText>>);

    await checkGuardrails({
      question: "Tell me about rdoc",
      openrouter: mockOpenrouter,
    });

    expect(mockedGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining("When in doubt"),
      }),
    );
  });

  it("system prompt includes general module question examples as relevant", async () => {
    mockedGenerateText.mockResolvedValue({
      output: { relevant: true, reason: "" },
    } as Awaited<ReturnType<typeof generateText>>);

    await checkGuardrails({
      question: "Tell me about rdoc",
      openrouter: mockOpenrouter,
    });

    expect(mockedGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining("Tell me about rdoc"),
      }),
    );
  });

  it("system prompt explicitly rejects code implementation requests", async () => {
    mockedGenerateText.mockResolvedValue({
      output: { relevant: false, reason: "Code implementation request" },
    } as Awaited<ReturnType<typeof generateText>>);

    await checkGuardrails({
      question: "How do I use Array?",
      openrouter: mockOpenrouter,
    });

    expect(mockedGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining(
          "Requests for code examples, implementation help, or programming tutorials",
        ),
      }),
    );
  });

  it("does not include experimental_telemetry when no integrations", async () => {
    mockedGenerateText.mockResolvedValue({
      output: { relevant: true, reason: "" },
    } as Awaited<ReturnType<typeof generateText>>);

    await checkGuardrails({
      question: "Who maintains String?",
      openrouter: mockOpenrouter,
    });

    expect(mockedGenerateText).toHaveBeenCalledWith(
      expect.not.objectContaining({
        experimental_telemetry: expect.anything(),
      }),
    );
  });
});
