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

  constructor(config: LangfuseClientConfig) {
    this.publicKey = config.publicKey;
    this.secretKey = config.secretKey;
    this.baseUrl = config.baseUrl ?? "https://cloud.langfuse.com";
  }

  async createScore(
    traceId: string,
    name: string,
    value: number,
  ): Promise<void> {
    const url = `${this.baseUrl}/api/public/ingestion`;
    const auth = `Basic ${btoa(`${this.publicKey}:${this.secretKey}`)}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: auth,
        },
        body: JSON.stringify({
          batch: [
            {
              id: crypto.randomUUID(),
              type: "score-create",
              timestamp: new Date().toISOString(),
              body: {
                id: crypto.randomUUID(),
                traceId,
                name,
                value,
                dataType: "NUMERIC",
              },
            },
          ],
        }),
      });

      if (!response.ok) {
        console.warn(`Langfuse score failed: HTTP ${response.status}`);
      }
    } catch (error) {
      console.warn("Langfuse score failed:", error);
    }
  }
}
