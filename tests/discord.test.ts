import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

// --- Mock createContainer ---
const mockWorkflowCreate = vi.fn().mockResolvedValue({ id: "wf-1" });
const mockPatchDiscordResponse = vi.fn().mockResolvedValue(undefined);
const mockCreateLangfuseClient = vi.fn().mockReturnValue(null);

let TEST_PUBLIC_KEY_HEX: string;

vi.mock("../src/container", () => ({
  createContainer: () => ({
    discordPublicKey: TEST_PUBLIC_KEY_HEX,
    askWorkflow: {
      create: mockWorkflowCreate,
      get: vi.fn(),
    },
    patchDiscordResponse: mockPatchDiscordResponse,
    createLangfuseClient: mockCreateLangfuseClient,
  }),
}));

import { handleDiscordWebhook } from "../src/discord";

// --- Ed25519 key pair helpers ---

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

let mockCtx: Pick<ExecutionContext, "waitUntil">;
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
  };

  mockWorkflowCreate.mockClear();
  mockPatchDiscordResponse.mockClear();
  mockCreateLangfuseClient.mockClear().mockReturnValue(null);
});

// --- Tests ---

describe("handleDiscordWebhook", () => {
  it("returns 401 for missing signature headers", async () => {
    const request = new Request("http://localhost/webhook", {
      method: "POST",
      body: JSON.stringify({ type: 1 }),
    });

    const response = await handleDiscordWebhook(request, mockCtx);
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

    const response = await handleDiscordWebhook(request, mockCtx);
    expect(response.status).toBe(401);
  });

  it("responds with PONG to PING interaction", async () => {
    const request = await makeSignedRequest({ type: 1 });

    const response = await handleDiscordWebhook(request, mockCtx);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ type: 1 }); // PONG
  });

  it("returns 400 for unknown interaction type", async () => {
    const request = await makeSignedRequest({ type: 999 });

    const response = await handleDiscordWebhook(request, mockCtx);
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

    const response = await handleDiscordWebhook(request, mockCtx);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ type: 5 });

    await Promise.all(waitUntilPromises);

    expect(mockWorkflowCreate).toHaveBeenCalledOnce();
    expect(mockWorkflowCreate).toHaveBeenCalledWith({
      id: "interaction-1",
      params: {
        question: "What is Ruby?",
        interactionToken: "test-token",
        locale: "zh-TW",
        userId: "user1",
      },
    });
  });

  it("patches error message and does not start workflow when question is missing", async () => {
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

    const response = await handleDiscordWebhook(request, mockCtx);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ type: 5 });

    await Promise.all(waitUntilPromises);

    expect(mockWorkflowCreate).not.toHaveBeenCalled();

    expect(mockPatchDiscordResponse).toHaveBeenCalledOnce();
    const [token, payload] = mockPatchDiscordResponse.mock.calls[0]!;
    expect(token).toBe("test-token-2");
    expect(payload.content).toContain("Please provide a question");
  });

  describe("MessageComponent interactions (feedback)", () => {
    it("returns UpdateMessage with empty components and does not call Langfuse without keys", async () => {
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

      const response = await handleDiscordWebhook(request, mockCtx);
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.type).toBe(7); // UpdateMessage
      expect(body.data.components).toEqual([]);
      expect(waitUntilPromises).toHaveLength(0);
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

      const response = await handleDiscordWebhook(request, mockCtx);
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

      const response = await handleDiscordWebhook(request, mockCtx);
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.type).toBe(4); // ChannelMessageWithSource
      expect(body.data.flags).toBe(64); // Ephemeral
    });

    it("sends Langfuse score when feedback is valid", async () => {
      const mockFlush = vi.fn().mockResolvedValue(undefined);
      const mockCreateScore = vi.fn();
      mockCreateLangfuseClient.mockReturnValue({
        createScore: mockCreateScore,
        flush: mockFlush,
      });

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

      const response = await handleDiscordWebhook(request, mockCtx);
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.type).toBe(7); // UpdateMessage

      await Promise.all(waitUntilPromises);

      expect(mockCreateScore).toHaveBeenCalledWith(
        "trace-xyz",
        "user-feedback",
        -1, // down = -1
      );
      expect(mockFlush).toHaveBeenCalledOnce();
    });
  });
});
