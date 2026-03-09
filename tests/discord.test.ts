import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { handleDiscordWebhook } from "../src/discord";

// --- Ed25519 key pair helpers ---

let TEST_PUBLIC_KEY_HEX: string;
let signingKey: CryptoKey;

async function generateEd25519KeyPair() {
  const keyPair = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const publicKeyBuffer = (await crypto.subtle.exportKey(
    "raw",
    keyPair.publicKey,
  )) as ArrayBuffer;
  const publicKeyHex = Array.from(new Uint8Array(publicKeyBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return { publicKeyHex, privateKey: keyPair.privateKey };
}

async function signRequest(body: string, timestamp: string): Promise<string> {
  const message = new TextEncoder().encode(timestamp + body);
  const signature = await crypto.subtle.sign("Ed25519", signingKey, message);
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function makeSignedRequest(body: object): Promise<Request> {
  const bodyStr = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await signRequest(bodyStr, timestamp);
  return new Request("http://localhost/webhook", {
    method: "POST",
    headers: {
      "x-signature-ed25519": signature,
      "x-signature-timestamp": timestamp,
      "content-type": "application/json",
    },
    body: bodyStr,
  });
}

// --- Test setup ---

const TEST_APP_ID = "test-app-id";

let mockEnv: Env;
let mockCtx: ExecutionContext;
let waitUntilPromises: Promise<unknown>[];

beforeAll(async () => {
  const kp = await generateEd25519KeyPair();
  TEST_PUBLIC_KEY_HEX = kp.publicKeyHex;
  signingKey = kp.privateKey;
});

beforeEach(() => {
  waitUntilPromises = [];
  mockCtx = {
    waitUntil: (p: Promise<unknown>) => {
      waitUntilPromises.push(p);
    },
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;

  mockEnv = {
    DISCORD_PUBLIC_KEY: TEST_PUBLIC_KEY_HEX,
    DISCORD_APPLICATION_ID: TEST_APP_ID,
    DISCORD_BOT_TOKEN: "test-bot-token",
    OPENROUTER_API_KEY: "test-key",
    INTERNAL_API_URL: "http://internal.test",
    INTERNAL_API: {} as Fetcher,
    ASK_WORKFLOW: {
      create: vi.fn().mockResolvedValue({ id: "wf-1" }),
      get: vi.fn(),
    } as unknown as Workflow,
  } as unknown as Env;
});

// --- Tests ---

describe("handleDiscordWebhook", () => {
  it("returns 401 for missing signature headers", async () => {
    const request = new Request("http://localhost/webhook", {
      method: "POST",
      body: JSON.stringify({ type: 1 }),
    });

    const response = await handleDiscordWebhook(request, mockCtx, mockEnv);
    expect(response.status).toBe(401);
  });

  it("returns 401 for invalid signature", async () => {
    const request = new Request("http://localhost/webhook", {
      method: "POST",
      headers: {
        "x-signature-ed25519": "0".repeat(128),
        "x-signature-timestamp": "12345",
      },
      body: JSON.stringify({ type: 1 }),
    });

    const response = await handleDiscordWebhook(request, mockCtx, mockEnv);
    expect(response.status).toBe(401);
  });

  it("responds with PONG to PING interaction", async () => {
    const request = await makeSignedRequest({ type: 1 });

    const response = await handleDiscordWebhook(request, mockCtx, mockEnv);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ type: 1 }); // PONG
  });

  it("returns 400 for unknown interaction type", async () => {
    const request = await makeSignedRequest({ type: 999 });

    const response = await handleDiscordWebhook(request, mockCtx, mockEnv);
    expect(response.status).toBe(400);
  });

  it("returns deferred response (type 5) for /ask command with question", async () => {
    const request = await makeSignedRequest({
      type: 2,
      id: "interaction-1",
      token: "test-token",
      data: {
        name: "ask",
        options: [{ name: "question", type: 3, value: "What is Ruby?" }],
      },
      guild_id: "guild1",
      channel_id: "channel1",
      member: {
        user: { id: "user1", username: "testuser" },
      },
    });

    const response = await handleDiscordWebhook(request, mockCtx, mockEnv);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ type: 5 });

    await Promise.all(waitUntilPromises);

    const workflowCreate = (mockEnv.ASK_WORKFLOW as any).create;
    expect(workflowCreate).toHaveBeenCalledOnce();
    expect(workflowCreate).toHaveBeenCalledWith({
      id: "interaction-1",
      params: {
        question: "What is Ruby?",
        interactionToken: "test-token",
        applicationId: TEST_APP_ID,
        locale: "zh-TW",
        userId: "user1",
      },
    });
  });

  it("patches error message and does not start workflow when question is missing", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("ok"));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    try {
      const request = await makeSignedRequest({
        type: 2,
        id: "interaction-2",
        token: "test-token-2",
        data: { name: "ask" },
        guild_id: "guild1",
        channel_id: "channel1",
        member: {
          user: { id: "user1", username: "testuser" },
        },
      });

      const response = await handleDiscordWebhook(request, mockCtx, mockEnv);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ type: 5 });

      await Promise.all(waitUntilPromises);

      const workflowCreate = (mockEnv.ASK_WORKFLOW as any).create;
      expect(workflowCreate).not.toHaveBeenCalled();

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0]!;
      expect(url).toContain(
        "/webhooks/test-app-id/test-token-2/messages/@original",
      );
      expect(opts.method).toBe("PATCH");
      const patchBody = JSON.parse(opts.body);
      expect(patchBody.content).toContain("Please provide a question");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  describe("MessageComponent interactions (feedback)", () => {
    it("returns UpdateMessage with empty components and does not call Langfuse without keys", async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response("ok"));
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mockFetch;

      try {
        const request = await makeSignedRequest({
          type: 3, // MessageComponent
          id: "interaction-fb-1",
          token: "fb-token",
          data: {
            component_type: 2,
            custom_id: "feedback:trace-abc:user1:up",
          },
          member: {
            user: { id: "user1", username: "testuser" },
          },
        });

        const response = await handleDiscordWebhook(request, mockCtx, mockEnv);
        expect(response.status).toBe(200);
        const body = (await response.json()) as any;
        expect(body.type).toBe(7); // UpdateMessage
        expect(body.data.components).toEqual([]);
        expect(waitUntilPromises).toHaveLength(0);
        expect(mockFetch).not.toHaveBeenCalled();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("returns ephemeral message when non-original user clicks feedback", async () => {
      const request = await makeSignedRequest({
        type: 3,
        id: "interaction-fb-2",
        token: "fb-token-2",
        data: {
          component_type: 2,
          custom_id: "feedback:trace-abc:user1:down",
        },
        member: {
          user: { id: "user-other", username: "otheruser" },
        },
      });

      const response = await handleDiscordWebhook(request, mockCtx, mockEnv);
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.type).toBe(4); // ChannelMessageWithSource
      expect(body.data.flags).toBe(64); // Ephemeral
      expect(body.data.content).toContain("只有提問者可以評分");
    });

    it("returns ephemeral error for invalid custom_id", async () => {
      const request = await makeSignedRequest({
        type: 3,
        id: "interaction-fb-3",
        token: "fb-token-3",
        data: {
          component_type: 2,
          custom_id: "invalid-format",
        },
        member: {
          user: { id: "user1", username: "testuser" },
        },
      });

      const response = await handleDiscordWebhook(request, mockCtx, mockEnv);
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.type).toBe(4); // ChannelMessageWithSource
      expect(body.data.flags).toBe(64); // Ephemeral
    });

    it("sends Langfuse score when feedback is valid", async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response("ok"));
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mockFetch;

      const envWithLangfuse = {
        ...mockEnv,
        LANGFUSE_PUBLIC_KEY: "pk-test",
        LANGFUSE_SECRET_KEY: "sk-test",
        LANGFUSE_BASE_URL: "https://langfuse.test",
      } as unknown as Env;

      try {
        const request = await makeSignedRequest({
          type: 3,
          id: "interaction-fb-4",
          token: "fb-token-4",
          data: {
            component_type: 2,
            custom_id: "feedback:trace-xyz:user1:down",
          },
          member: {
            user: { id: "user1", username: "testuser" },
          },
        });

        const response = await handleDiscordWebhook(
          request,
          mockCtx,
          envWithLangfuse,
        );
        expect(response.status).toBe(200);
        const body = (await response.json()) as any;
        expect(body.type).toBe(7); // UpdateMessage

        await Promise.all(waitUntilPromises);

        expect(mockFetch).toHaveBeenCalledOnce();
        const [url, opts] = mockFetch.mock.calls[0]!;
        expect(url).toBe("https://langfuse.test/api/public/ingestion");
        const batchBody = JSON.parse(opts.body);
        const scoreEvent = batchBody.batch[0];
        expect(scoreEvent.type).toBe("score-create");
        expect(scoreEvent.body.traceId).toBe("trace-xyz");
        expect(scoreEvent.body.name).toBe("user-feedback");
        expect(scoreEvent.body.value).toBe(0); // down = 0
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
