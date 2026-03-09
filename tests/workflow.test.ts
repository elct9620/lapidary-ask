import { describe, it, expect } from "vitest";
import { env, introspectWorkflowInstance } from "cloudflare:test";
import { createTelemetryContext } from "../src/workflows/ask";

const workflowParams = {
  question: "Who maintains String?",
  interactionToken: "token-123",
  applicationId: "app-id",
  locale: "zh-TW",
  userId: "user-123",
};

describe("createTelemetryContext", () => {
  it("should return empty object when env keys missing", () => {
    const result = createTelemetryContext({} as Env);
    expect(result).toEqual({});
    expect(result.tracer).toBeUndefined();
    expect(result.integrations).toBeUndefined();
  });

  it("should return tracer and integrations when env keys present", () => {
    const result = createTelemetryContext({
      LANGFUSE_PUBLIC_KEY: "pk-test",
      LANGFUSE_SECRET_KEY: "sk-test",
    } as Env);

    expect(result.tracer).toBeDefined();
    expect(result.integrations).toHaveLength(1);
  });

  it("should set traceId when traceId option provided", () => {
    const result = createTelemetryContext(
      {
        LANGFUSE_PUBLIC_KEY: "pk-test",
        LANGFUSE_SECRET_KEY: "sk-test",
      } as Env,
      { traceId: "existing-trace-id" },
    );

    expect(result.tracer).toBeDefined();
    expect(result.tracer!.traceId).toBe("existing-trace-id");
  });

  it("should not set traceId when traceId option omitted", () => {
    const result = createTelemetryContext({
      LANGFUSE_PUBLIC_KEY: "pk-test",
      LANGFUSE_SECRET_KEY: "sk-test",
    } as Env);

    expect(result.tracer!.traceId).toBeNull();
  });
});

describe("AskWorkflow", () => {
  it("happy path: guardrails pass -> askLLM -> post response", async () => {
    await using instance = await introspectWorkflowInstance(
      env.ASK_WORKFLOW,
      "test-happy",
    );

    await instance.modify(async (m) => {
      await m.disableSleeps();
      await m.mockStepResult(
        { name: "check-guardrails" },
        { relevant: true, reason: "", traceId: undefined },
      );
      await m.mockStepResult(
        { name: "ask-llm" },
        "Ruby String is maintained by...",
      );
      await m.mockStepResult({ name: "post-response" }, true);
    });

    await env.ASK_WORKFLOW.create({ id: "test-happy", params: workflowParams });

    const guardrailsResult = await instance.waitForStepResult({
      name: "check-guardrails",
    });
    expect(guardrailsResult).toEqual({
      relevant: true,
      reason: "",
      traceId: undefined,
    });

    const llmResult = await instance.waitForStepResult({ name: "ask-llm" });
    expect(llmResult).toBe("Ruby String is maintained by...");

    await instance.waitForStepResult({ name: "post-response" });
    await expect(instance.waitForStatus("complete")).resolves.not.toThrow();
  });

  it("guardrails rejection: posts rejection reason without calling LLM", async () => {
    await using instance = await introspectWorkflowInstance(
      env.ASK_WORKFLOW,
      "test-rejection",
    );

    await instance.modify(async (m) => {
      await m.disableSleeps();
      await m.mockStepResult(
        { name: "check-guardrails" },
        {
          relevant: false,
          reason: "This is not related to Ruby.",
          traceId: undefined,
        },
      );
      await m.mockStepResult({ name: "post-guardrails-rejection" }, true);
    });

    await env.ASK_WORKFLOW.create({
      id: "test-rejection",
      params: workflowParams,
    });

    const guardrailsResult = await instance.waitForStepResult({
      name: "check-guardrails",
    });
    expect(guardrailsResult).toEqual(
      expect.objectContaining({ relevant: false }),
    );

    await instance.waitForStepResult({ name: "post-guardrails-rejection" });
    await expect(instance.waitForStatus("complete")).resolves.not.toThrow();
  });

  it(
    "LLM error: posts error message to Discord",
    { timeout: 15_000 },
    async () => {
      await using instance = await introspectWorkflowInstance(
        env.ASK_WORKFLOW,
        "test-llm-error",
      );

      await instance.modify(async (m) => {
        await m.disableSleeps();
        await m.mockStepResult(
          { name: "check-guardrails" },
          { relevant: true, reason: "", traceId: undefined },
        );
        await m.mockStepError({ name: "ask-llm" }, new Error("LLM API failed"));
        await m.mockStepResult({ name: "report-llm-error" }, true);
      });

      await env.ASK_WORKFLOW.create({
        id: "test-llm-error",
        params: workflowParams,
      });

      await instance.waitForStepResult({ name: "report-llm-error" });
      await expect(instance.waitForStatus("complete")).resolves.not.toThrow();
    },
  );

  it(
    "post-response error: reports fallback error message",
    { timeout: 15_000 },
    async () => {
      await using instance = await introspectWorkflowInstance(
        env.ASK_WORKFLOW,
        "test-post-error",
      );

      await instance.modify(async (m) => {
        await m.disableSleeps();
        await m.mockStepResult(
          { name: "check-guardrails" },
          { relevant: true, reason: "", traceId: undefined },
        );
        await m.mockStepResult({ name: "ask-llm" }, "Some answer");
        await m.mockStepError(
          { name: "post-response" },
          new Error("Discord API error"),
        );
        await m.mockStepResult({ name: "report-post-error" }, true);
      });

      await env.ASK_WORKFLOW.create({
        id: "test-post-error",
        params: workflowParams,
      });

      await instance.waitForStepResult({ name: "report-post-error" });
      await expect(instance.waitForStatus("complete")).resolves.not.toThrow();
    },
  );
});
