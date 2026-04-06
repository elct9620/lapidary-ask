import { createTracerProvider, type TracerProvider } from "@aotoki/edge-otel";
import { langfuseExporter } from "@aotoki/edge-otel/exporters/langfuse";

export interface LangfuseTracerOptions {
  publicKey: string;
  secretKey: string;
  baseUrl?: string;
  environment?: string;
}

export function createLangfuseTracerProvider(
  options: LangfuseTracerOptions,
): TracerProvider {
  const exporter = langfuseExporter({
    publicKey: options.publicKey,
    secretKey: options.secretKey,
    baseUrl: options.baseUrl,
    environment: options.environment,
  });
  return createTracerProvider({
    ...exporter,
    serviceName: "ruby-lapidary-ask",
  });
}
