import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { handleDiscordWebhook } from "../src/discord";

// --- Ed25519 key pair helpers ---

let TEST_PUBLIC_KEY_HEX: string;
let signingKey: CryptoKey;

async function generateEd25519KeyPair() {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]);
  const publicKeyBuffer = await crypto.subtle.exportKey(
    "raw",
    keyPair.publicKey,
  );
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
});
