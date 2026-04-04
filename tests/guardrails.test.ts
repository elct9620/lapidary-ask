import { describe, it, expect, vi, beforeEach } from "vitest";

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
const mockGoogle = vi.fn((model: string) => `google:${model}`) as any;

describe("checkGuardrails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns relevant: true for related questions", async () => {
    mockedGenerateText.mockResolvedValue({
      output: {
        reasoning: "About Ruby maintainers",
        relevant: true,
        reason: "",
      },
    } as Awaited<ReturnType<typeof generateText>>);

    const result = await checkGuardrails({
      question: "Who maintains the String module?",
      openrouter: mockOpenrouter,
    });

    expect(result).toEqual({
      reasoning: "About Ruby maintainers",
      relevant: true,
      reason: "",
    });
  });

  it("returns relevant: false with reason for unrelated questions", async () => {
    mockedGenerateText.mockResolvedValue({
      output: {
        reasoning: "This is about cooking, not Ruby",
        relevant: false,
        reason: "This question is about cooking, not Ruby.",
      },
    } as Awaited<ReturnType<typeof generateText>>);

    const result = await checkGuardrails({
      question: "How do I cook pasta?",
      openrouter: mockOpenrouter,
    });

    expect(result).toEqual({
      reasoning: "This is about cooking, not Ruby",
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

    expect(result).toEqual({ reasoning: "", relevant: true, reason: "" });
  });

  it("fail-opens when output is null", async () => {
    mockedGenerateText.mockResolvedValue({
      output: null,
    } as Awaited<ReturnType<typeof generateText>>);

    const result = await checkGuardrails({
      question: "test question",
      openrouter: mockOpenrouter,
    });

    expect(result).toEqual({ reasoning: "", relevant: true, reason: "" });
  });

  it("includes language instruction in system prompt when locale is provided", async () => {
    mockedGenerateText.mockResolvedValue({
      output: { reasoning: "...", relevant: false, reason: "..." },
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
      output: { reasoning: "...", relevant: true, reason: "" },
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

  it("uses openrouter model when google is not provided", async () => {
    mockedGenerateText.mockResolvedValue({
      output: { reasoning: "...", relevant: true, reason: "" },
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

  it("uses google as primary provider when available", async () => {
    mockedGenerateText.mockResolvedValue({
      output: { reasoning: "...", relevant: true, reason: "" },
    } as Awaited<ReturnType<typeof generateText>>);

    await checkGuardrails({
      question: "Who maintains String?",
      openrouter: mockOpenrouter,
      google: mockGoogle,
    });

    expect(mockedGenerateText).toHaveBeenCalledTimes(1);
    expect(mockedGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "google:gemma-4-26b-a4b-it",
      }),
    );
  });

  it("falls back to openrouter when google fails", async () => {
    mockedGenerateText
      .mockRejectedValueOnce(new Error("Google API error"))
      .mockResolvedValueOnce({
        output: { reasoning: "...", relevant: true, reason: "" },
      } as Awaited<ReturnType<typeof generateText>>);

    const result = await checkGuardrails({
      question: "Who maintains String?",
      openrouter: mockOpenrouter,
      google: mockGoogle,
    });

    expect(result).toEqual({ reasoning: "...", relevant: true, reason: "" });
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

  it("fail-opens when both providers fail", async () => {
    mockedGenerateText
      .mockRejectedValueOnce(new Error("Google API error"))
      .mockRejectedValueOnce(new Error("OpenRouter API error"));

    const result = await checkGuardrails({
      question: "Who maintains String?",
      openrouter: mockOpenrouter,
      google: mockGoogle,
    });

    expect(result).toEqual({ reasoning: "", relevant: true, reason: "" });
  });

  it("uses custom model names when provided", async () => {
    mockedGenerateText.mockResolvedValue({
      output: { reasoning: "...", relevant: true, reason: "" },
    } as Awaited<ReturnType<typeof generateText>>);

    await checkGuardrails({
      question: "Who maintains String?",
      openrouter: mockOpenrouter,
      google: mockGoogle,
      aiStudioModel: "gemma-4-31b-it",
      openrouterModel: "google/gemma-3-27b-it",
    });

    expect(mockedGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "google:gemma-4-31b-it",
      }),
    );
  });

  it("passes integrations to generateText when provided", async () => {
    mockedGenerateText.mockResolvedValue({
      output: { reasoning: "...", relevant: true, reason: "" },
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
      output: { reasoning: "...", relevant: true, reason: "" },
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
      output: { reasoning: "...", relevant: true, reason: "" },
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
      output: {
        reasoning: "...",
        relevant: false,
        reason: "Code implementation request",
      },
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

  it("system prompt includes indirect Rubyist relationships as relevant", async () => {
    mockedGenerateText.mockResolvedValue({
      output: { reasoning: "...", relevant: true, reason: "" },
    } as Awaited<ReturnType<typeof generateText>>);

    await checkGuardrails({
      question: "matz 跟誰合作過?",
      openrouter: mockOpenrouter,
    });

    expect(mockedGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining(
          "Indirect relationships between Rubyists",
        ),
      }),
    );
  });

  it("system prompt domain check covers indirect Rubyist relationships", async () => {
    mockedGenerateText.mockResolvedValue({
      output: { reasoning: "...", relevant: true, reason: "" },
    } as Awaited<ReturnType<typeof generateText>>);

    await checkGuardrails({
      question: "matz 跟誰合作過?",
      openrouter: mockOpenrouter,
    });

    expect(mockedGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining(
          "indirect Rubyist-to-Rubyist relationships",
        ),
      }),
    );
  });

  it("system prompt includes step-by-step classification instructions", async () => {
    mockedGenerateText.mockResolvedValue({
      output: { reasoning: "...", relevant: true, reason: "" },
    } as Awaited<ReturnType<typeof generateText>>);

    await checkGuardrails({
      question: "matz 跟誰一起工作過?",
      openrouter: mockOpenrouter,
    });

    expect(mockedGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining("<workflow>"),
      }),
    );
  });

  it("system prompt includes intent interpretation examples for ambiguous queries", async () => {
    mockedGenerateText.mockResolvedValue({
      output: { reasoning: "...", relevant: true, reason: "" },
    } as Awaited<ReturnType<typeof generateText>>);

    await checkGuardrails({
      question: "redos 的近況",
      openrouter: mockOpenrouter,
    });

    expect(mockedGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining("co-contributors sharing modules"),
      }),
    );
  });

  it("schema includes reasoning field for CoT analysis", async () => {
    mockedGenerateText.mockResolvedValue({
      output: {
        reasoning: "The user asks about ReDOS which relates to Regexp module",
        relevant: true,
        reason: "",
      },
    } as Awaited<ReturnType<typeof generateText>>);

    const result = await checkGuardrails({
      question: "redos 的近況",
      openrouter: mockOpenrouter,
    });

    expect(result).toEqual({
      reasoning: "The user asks about ReDOS which relates to Regexp module",
      relevant: true,
      reason: "",
    });
  });

  it("does not include experimental_telemetry when no integrations", async () => {
    mockedGenerateText.mockResolvedValue({
      output: { reasoning: "...", relevant: true, reason: "" },
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
