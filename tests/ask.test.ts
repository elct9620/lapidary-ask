import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
} from "vitest";
import { fetchMock } from "cloudflare:test";
import { createBot } from "../src/bot";

// --- Mock AI SDK ---

const mockGenerateText = vi.fn();
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: (...args: unknown[]) => mockGenerateText(...args),
  };
});

// --- Ed25519 key pair helpers (from adapter tests) ---

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

async function makeSignedRequest(url: string, body: object): Promise<Request> {
  const bodyStr = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await signRequest(bodyStr, timestamp);
  return new Request(url, {
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
const TEST_BOT_TOKEN = "test-bot-token";
const TEST_API_KEY = "test-openrouter-key";

let bot: ReturnType<typeof createBot>;

beforeAll(async () => {
  const kp = await generateEd25519KeyPair();
  TEST_PUBLIC_KEY_HEX = kp.publicKeyHex;
  signingKey = kp.privateKey;

  fetchMock.activate();
  fetchMock.disableNetConnect();
});

beforeEach(() => {
  bot = createBot({
    DISCORD_BOT_TOKEN: TEST_BOT_TOKEN,
    DISCORD_PUBLIC_KEY: TEST_PUBLIC_KEY_HEX,
    DISCORD_APPLICATION_ID: TEST_APP_ID,
    OPENROUTER_API_KEY: TEST_API_KEY,
  });

  mockGenerateText.mockReset();
});

afterEach(() => {
  fetchMock.assertNoPendingInterceptors();
});

// --- Helpers ---

function makeAskInteraction(options?: { question?: string }) {
  const interactionOptions = options?.question
    ? [{ name: "question", type: 3, value: options.question }]
    : undefined;

  return {
    type: 2, // APPLICATION_COMMAND
    id: "interaction-1",
    token: "test-interaction-token",
    data: {
      name: "ask",
      ...(interactionOptions && { options: interactionOptions }),
    },
    guild_id: "guild1",
    channel_id: "channel1",
    member: {
      user: {
        id: "user1",
        username: "testuser",
        global_name: "Test User",
      },
    },
  };
}

function mockDiscordWebhook() {
  fetchMock
    .get("https://discord.com")
    .intercept({
      path: `/api/v10/webhooks/${TEST_APP_ID}/test-interaction-token/messages/@original`,
      method: "PATCH",
    })
    .reply(200, JSON.stringify({ id: "msg-1" }));
}

// --- Tests ---

describe("/ask command integration", () => {
  it("returns deferred response (type 5)", async () => {
    mockGenerateText.mockResolvedValue({ text: "test answer" });
    mockDiscordWebhook();

    const waitUntilPromises: Promise<unknown>[] = [];
    const request = await makeSignedRequest(
      "http://localhost/webhook",
      makeAskInteraction({ question: "What is Ruby?" }),
    );

    const response = await bot.webhooks.discord(request, {
      waitUntil: (p: Promise<unknown>) => {
        waitUntilPromises.push(p);
      },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ type: 5 });

    await Promise.all(waitUntilPromises);
  });

  it("calls LLM and sends response via Discord webhook", async () => {
    mockGenerateText.mockResolvedValue({
      text: "Ruby is a programming language.",
    });
    mockDiscordWebhook();

    const waitUntilPromises: Promise<unknown>[] = [];
    const request = await makeSignedRequest(
      "http://localhost/webhook",
      makeAskInteraction({ question: "What is Ruby?" }),
    );

    await bot.webhooks.discord(request, {
      waitUntil: (p: Promise<unknown>) => {
        waitUntilPromises.push(p);
      },
    });

    await Promise.all(waitUntilPromises);

    // Verify generateText was called with the question
    expect(mockGenerateText).toHaveBeenCalledOnce();
    const callArgs = mockGenerateText.mock.calls[0]![0];
    expect(callArgs.prompt).toBe("What is Ruby?");

    // fetchMock.assertNoPendingInterceptors() in afterEach verifies
    // the Discord webhook was called
  });

  it("sends error message when question is missing", async () => {
    mockDiscordWebhook();

    const waitUntilPromises: Promise<unknown>[] = [];
    const request = await makeSignedRequest(
      "http://localhost/webhook",
      makeAskInteraction(), // no question
    );

    await bot.webhooks.discord(request, {
      waitUntil: (p: Promise<unknown>) => {
        waitUntilPromises.push(p);
      },
    });

    await Promise.all(waitUntilPromises);

    // generateText should NOT be called
    expect(mockGenerateText).not.toHaveBeenCalled();

    // fetchMock.assertNoPendingInterceptors() in afterEach verifies
    // the Discord webhook was called with the error message
  });
});
