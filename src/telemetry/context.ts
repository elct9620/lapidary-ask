import { createLangfuseClient } from "./client";
import { LangfuseTracer } from "./tracer";
import { LangfuseTelemetryIntegration } from "./integration";

export function createTelemetryContext(
  env: Env,
  options?: {
    traceId?: string;
    agentName?: string;
    skipAgentSpan?: boolean;
    parentId?: string;
  },
): { tracer?: LangfuseTracer; integrations?: LangfuseTelemetryIntegration[] } {
  if (!env.LANGFUSE_PUBLIC_KEY || !env.LANGFUSE_SECRET_KEY) {
    return {};
  }

  const client = createLangfuseClient(env);

  const tracer = new LangfuseTracer({
    client,
    environment: env.ENVIRONMENT,
  });

  if (options?.traceId) {
    tracer.setTraceId(options.traceId);
  }

  const integrations = [
    new LangfuseTelemetryIntegration({
      tracer,
      agentName: options?.agentName,
      skipAgentSpan: options?.skipAgentSpan,
      parentId: options?.parentId,
    }),
  ];

  return { tracer, integrations };
}
