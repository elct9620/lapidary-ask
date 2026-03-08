import type { TelemetryIntegration } from "ai";
import type { Flushable } from "../telemetry/langfuse";

type Integration = TelemetryIntegration & Flushable;

export function buildTelemetryConfig(integrations?: Integration[]) {
  if (!integrations) return {};
  return { experimental_telemetry: { isEnabled: true, integrations } };
}

export async function flushIntegrations(
  integrations?: Integration[],
): Promise<void> {
  if (integrations) {
    await Promise.allSettled(integrations.map((i) => i.flush()));
  }
}
