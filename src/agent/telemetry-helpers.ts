import type { TelemetryIntegration } from "ai";

export function buildTelemetryConfig(integrations?: TelemetryIntegration[]) {
  if (!integrations) return {};
  return { experimental_telemetry: { isEnabled: true, integrations } };
}
