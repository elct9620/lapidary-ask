import type { LangfuseEvent } from "./types";

export interface LangfuseClientConfig {
  publicKey: string;
  secretKey: string;
  baseUrl?: string;
}

export function createLangfuseClient(env: Env): LangfuseClient {
  return new LangfuseClient({
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    secretKey: env.LANGFUSE_SECRET_KEY,
    baseUrl: env.LANGFUSE_BASE_URL,
  });
}

export class LangfuseClient {
  private readonly publicKey: string;
  private readonly secretKey: string;
  private readonly baseUrl: string;
  private events: LangfuseEvent[] = [];

  constructor(config: LangfuseClientConfig) {
    this.publicKey = config.publicKey;
    this.secretKey = config.secretKey;
    this.baseUrl = config.baseUrl ?? "https://cloud.langfuse.com";
  }

  emit(event: LangfuseEvent): void {
    this.events.push(event);
  }

  createScore(traceId: string, name: string, value: number): void {
    this.emit({
      id: crypto.randomUUID(),
      type: "score-create",
      timestamp: new Date().toISOString(),
      body: {
        traceId,
        name,
        value,
        dataType: "NUMERIC",
      },
    });
  }

  async flush(): Promise<void> {
    if (this.events.length === 0) {
      return;
    }

    const url = `${this.baseUrl}/api/public/ingestion`;
    const auth = `Basic ${btoa(`${this.publicKey}:${this.secretKey}`)}`;

    try {
      await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: auth,
        },
        body: JSON.stringify({ batch: this.events }),
      });
    } catch (error) {
      console.warn("Langfuse flush failed:", error);
    }

    this.events = [];
  }
}
