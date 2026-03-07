import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import {
  createDiscordAdapter,
  DiscordAdapter,
  type DiscordAdapterConfig,
} from "../../src/adapter/discord";
import {
  DiscordFormatConverter,
  cardToDiscordPayload,
  cardToFallbackText,
} from "../../src/adapter/discord/format";
import { parseMarkdown, type CardElement } from "chat";

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

let TEST_CONFIG: DiscordAdapterConfig;

beforeAll(async () => {
  const kp = await generateEd25519KeyPair();
  TEST_PUBLIC_KEY_HEX = kp.publicKeyHex;
  signingKey = kp.privateKey;
  TEST_CONFIG = {
    applicationId: "test-app-id",
    botToken: "test-bot-token",
    publicKey: TEST_PUBLIC_KEY_HEX,
  };
});

// --- Mock ChatInstance ---

function createMockChat() {
  return {
    getLogger: vi.fn(() => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(),
    })),
    getState: vi.fn(),
    getUserName: vi.fn(() => "test-bot"),
    handleIncomingMessage: vi.fn(),
    processAction: vi.fn(),
    processAppHomeOpened: vi.fn(),
    processAssistantContextChanged: vi.fn(),
    processAssistantThreadStarted: vi.fn(),
    processMemberJoinedChannel: vi.fn(),
    processMessage: vi.fn(),
    processModalClose: vi.fn(),
    processModalSubmit: vi.fn(),
    processReaction: vi.fn(),
    processSlashCommand: vi.fn(),
  };
}

describe("DiscordAdapter", () => {
  describe("createDiscordAdapter", () => {
    it("returns a DiscordAdapter instance", () => {
      const adapter = createDiscordAdapter(TEST_CONFIG);
      expect(adapter).toBeInstanceOf(DiscordAdapter);
      expect(adapter.name).toBe("discord");
    });
  });

  describe("encodeThreadId / decodeThreadId", () => {
    it("encodes and decodes a channel thread ID", () => {
      const adapter = createDiscordAdapter(TEST_CONFIG);
      const encoded = adapter.encodeThreadId({
        guildId: "guild123",
        channelId: "channel456",
      });
      expect(encoded).toBe("discord:guild123:channel456");

      const decoded = adapter.decodeThreadId(encoded);
      expect(decoded).toEqual({
        guildId: "guild123",
        channelId: "channel456",
        threadId: undefined,
      });
    });

    it("encodes and decodes with threadId", () => {
      const adapter = createDiscordAdapter(TEST_CONFIG);
      const encoded = adapter.encodeThreadId({
        guildId: "guild123",
        channelId: "channel456",
        threadId: "thread789",
      });
      expect(encoded).toBe("discord:guild123:channel456:thread789");

      const decoded = adapter.decodeThreadId(encoded);
      expect(decoded).toEqual({
        guildId: "guild123",
        channelId: "channel456",
        threadId: "thread789",
      });
    });

    it("throws on invalid thread ID format", () => {
      const adapter = createDiscordAdapter(TEST_CONFIG);
      expect(() => adapter.decodeThreadId("invalid")).toThrow(
        "Invalid Discord thread ID",
      );
    });
  });

  describe("isDM", () => {
    it("returns true for @me guild", () => {
      const adapter = createDiscordAdapter(TEST_CONFIG);
      expect(adapter.isDM("discord:@me:channel123")).toBe(true);
    });

    it("returns false for guild thread", () => {
      const adapter = createDiscordAdapter(TEST_CONFIG);
      expect(adapter.isDM("discord:guild123:channel456")).toBe(false);
    });
  });

  describe("handleWebhook", () => {
    it("returns 401 for missing signature headers", async () => {
      const adapter = createDiscordAdapter(TEST_CONFIG);
      const request = new Request("http://localhost/webhook", {
        method: "POST",
        body: JSON.stringify({ type: 1 }),
      });

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(401);
    });

    it("returns 401 for invalid signature", async () => {
      const adapter = createDiscordAdapter(TEST_CONFIG);
      const request = new Request("http://localhost/webhook", {
        method: "POST",
        headers: {
          "x-signature-ed25519": "0".repeat(128),
          "x-signature-timestamp": "12345",
        },
        body: JSON.stringify({ type: 1 }),
      });

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(401);
    });

    it("responds with PONG to PING interaction", async () => {
      const adapter = createDiscordAdapter(TEST_CONFIG);
      const request = await makeSignedRequest({ type: 1 });

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ type: 1 }); // PONG
    });

    it("returns 400 for unknown interaction type", async () => {
      const adapter = createDiscordAdapter(TEST_CONFIG);
      const request = await makeSignedRequest({ type: 999 });

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(400);
      expect(await response.text()).toBe("Unknown interaction type");
    });

    it("returns deferred response (type 5) for APPLICATION_COMMAND", async () => {
      const adapter = createDiscordAdapter(TEST_CONFIG);
      const mockChat = createMockChat();
      await adapter.initialize(mockChat as any);

      const request = await makeSignedRequest({
        type: 2, // APPLICATION_COMMAND
        id: "interaction-1",
        token: "interaction-token",
        data: {
          name: "ask",
          options: [{ name: "question", type: 3, value: "hello?" }],
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
      });

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ type: 5 }); // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
    });

    it("calls processSlashCommand on APPLICATION_COMMAND", async () => {
      const adapter = createDiscordAdapter(TEST_CONFIG);
      const mockChat = createMockChat();
      await adapter.initialize(mockChat as any);

      const request = await makeSignedRequest({
        type: 2,
        id: "interaction-1",
        token: "interaction-token",
        data: {
          name: "ask",
          options: [{ name: "question", type: 3, value: "hello?" }],
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
      });

      await adapter.handleWebhook(request);
      expect(mockChat.processSlashCommand).toHaveBeenCalledOnce();

      const call = mockChat.processSlashCommand.mock.calls[0]![0];
      expect(call.command).toBe("/ask");
      expect(call.text).toBe("hello?");
      expect(call.user.userId).toBe("user1");
      expect(call.channelId).toBe("discord:guild1:channel1");
    });

    it("parses subcommands in slash command", async () => {
      const adapter = createDiscordAdapter(TEST_CONFIG);
      const mockChat = createMockChat();
      await adapter.initialize(mockChat as any);

      const request = await makeSignedRequest({
        type: 2,
        id: "interaction-2",
        token: "interaction-token",
        data: {
          name: "project",
          options: [
            {
              name: "issue",
              options: [
                {
                  name: "create",
                  options: [{ name: "title", type: 3, value: "bug fix" }],
                },
              ],
            },
          ],
        },
        guild_id: "guild1",
        channel_id: "channel1",
        member: {
          user: { id: "user1", username: "testuser" },
        },
      });

      await adapter.handleWebhook(request);
      const call = mockChat.processSlashCommand.mock.calls[0]![0];
      expect(call.command).toBe("/project issue create");
      expect(call.text).toBe("bug fix");
    });

    it("returns deferred update (type 6) for MESSAGE_COMPONENT", async () => {
      const adapter = createDiscordAdapter(TEST_CONFIG);
      const mockChat = createMockChat();
      await adapter.initialize(mockChat as any);

      const request = await makeSignedRequest({
        type: 3, // MESSAGE_COMPONENT
        id: "interaction-3",
        token: "interaction-token",
        data: { custom_id: "btn_approve" },
        guild_id: "guild1",
        channel_id: "channel1",
        message: { id: "msg1" },
        member: {
          user: { id: "user1", username: "testuser", global_name: "Test" },
        },
      });

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ type: 6 }); // DEFERRED_UPDATE_MESSAGE
    });

    it("calls processAction on MESSAGE_COMPONENT", async () => {
      const adapter = createDiscordAdapter(TEST_CONFIG);
      const mockChat = createMockChat();
      await adapter.initialize(mockChat as any);

      const request = await makeSignedRequest({
        type: 3,
        id: "interaction-3",
        token: "interaction-token",
        data: { custom_id: "btn_approve" },
        guild_id: "guild1",
        channel_id: "channel1",
        message: { id: "msg1" },
        member: {
          user: { id: "user1", username: "testuser", global_name: "Test" },
        },
      });

      await adapter.handleWebhook(request);
      expect(mockChat.processAction).toHaveBeenCalledOnce();

      const call = mockChat.processAction.mock.calls[0]![0];
      expect(call.actionId).toBe("btn_approve");
      expect(call.messageId).toBe("msg1");
      expect(call.threadId).toBe("discord:guild1:channel1");
    });

    it("does not call processSlashCommand when chat is not initialized", async () => {
      const adapter = createDiscordAdapter(TEST_CONFIG);
      // Not calling initialize

      const request = await makeSignedRequest({
        type: 2,
        id: "interaction-1",
        token: "token",
        data: { name: "ask" },
        guild_id: "guild1",
        channel_id: "channel1",
        member: { user: { id: "user1", username: "testuser" } },
      });

      const response = await adapter.handleWebhook(request);
      // Should still return deferred response
      expect(response.status).toBe(200);
    });
  });

  describe("postMessage", () => {
    let adapter: DiscordAdapter;
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      adapter = createDiscordAdapter(TEST_CONFIG);
      originalFetch = globalThis.fetch;
    });

    it("posts via Discord API with bot token", async () => {
      const mockResponse = { id: "msg123", content: "hello" };
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify(mockResponse), { status: 200 }),
        );

      const result = await adapter.postMessage(
        "discord:guild1:channel1",
        "hello world",
      );

      expect(result.id).toBe("msg123");
      expect(result.threadId).toBe("discord:guild1:channel1");

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0]!;
      expect(fetchCall[0]).toBe(
        "https://discord.com/api/v10/channels/channel1/messages",
      );
      expect(fetchCall[1].headers.Authorization).toBe("Bot test-bot-token");

      globalThis.fetch = originalFetch;
    });

    it("posts to thread channel when threadId is present", async () => {
      const mockResponse = { id: "msg456", content: "hi" };
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify(mockResponse), { status: 200 }),
        );

      await adapter.postMessage("discord:guild1:channel1:thread1", "hi there");

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0]!;
      expect(fetchCall[0]).toBe(
        "https://discord.com/api/v10/channels/thread1/messages",
      );

      globalThis.fetch = originalFetch;
    });

    it("truncates content exceeding 2000 characters", async () => {
      const mockResponse = { id: "msg789" };
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify(mockResponse), { status: 200 }),
        );

      const longMessage = "a".repeat(2500);
      await adapter.postMessage("discord:guild1:channel1", longMessage);

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0]!;
      const body = JSON.parse(fetchCall[1].body);
      expect(body.content.length).toBe(2000);
      expect(body.content.endsWith("...")).toBe(true);

      globalThis.fetch = originalFetch;
    });

    it("posts via interaction webhook in slash command context", async () => {
      const mockChat = createMockChat();
      await adapter.initialize(mockChat as any);

      const mockApiResponse = { id: "resp1" };
      const mockFetch = vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify(mockApiResponse), { status: 200 }),
        );
      globalThis.fetch = mockFetch;

      // Use a promise to capture the async postMessage result from within ALS
      let postPromise: Promise<any>;

      mockChat.processSlashCommand.mockImplementation((event: any) => {
        postPromise = adapter.postMessage(event.channelId, "response text");
      });

      const request = await makeSignedRequest({
        type: 2,
        id: "int-1",
        token: "slash-token-123",
        data: { name: "ask", options: [{ name: "q", type: 3, value: "test" }] },
        guild_id: "guild1",
        channel_id: "channel1",
        member: { user: { id: "user1", username: "tester" } },
      });

      await adapter.handleWebhook(request);
      expect(mockChat.processSlashCommand).toHaveBeenCalledOnce();

      // Wait for the postMessage to complete
      const result = await postPromise!;
      expect(result.id).toBe("resp1");

      // Verify it used PATCH @original for initial response
      const fetchCall = mockFetch.mock.calls[0]!;
      expect(fetchCall[0]).toContain("/webhooks/test-app-id/slash-token-123");
      expect(fetchCall[0]).toContain("/messages/@original");
      expect(fetchCall[1].method).toBe("PATCH");
      // No Authorization header for interaction webhooks
      expect(fetchCall[1].headers?.Authorization).toBeUndefined();

      globalThis.fetch = originalFetch;
    });
  });

  describe("renderFormatted", () => {
    it("converts AST to Discord markdown", () => {
      const adapter = createDiscordAdapter(TEST_CONFIG);
      const ast = parseMarkdown("**bold** and *italic*");
      const result = adapter.renderFormatted(ast);
      expect(result).toContain("**bold**");
      expect(result).toContain("*italic*");
    });
  });

  describe("unsupported methods", () => {
    it("editMessage warns and returns empty result", async () => {
      const adapter = createDiscordAdapter(TEST_CONFIG);
      const result = await adapter.editMessage("discord:g:c", "msg1", "test");
      expect(result.id).toBe("");
    });

    it("deleteMessage warns without throwing", async () => {
      const adapter = createDiscordAdapter(TEST_CONFIG);
      await expect(
        adapter.deleteMessage("discord:g:c", "msg1"),
      ).resolves.toBeUndefined();
    });

    it("fetchMessages returns empty array", async () => {
      const adapter = createDiscordAdapter(TEST_CONFIG);
      const result = await adapter.fetchMessages("discord:g:c");
      expect(result.messages).toEqual([]);
    });

    it("fetchThread returns stub info", async () => {
      const adapter = createDiscordAdapter(TEST_CONFIG);
      const result = await adapter.fetchThread("discord:g:c");
      expect(result.id).toBe("discord:g:c");
      expect(result.isDM).toBe(false);
    });

    it("addReaction warns without throwing", async () => {
      const adapter = createDiscordAdapter(TEST_CONFIG);
      await expect(
        adapter.addReaction("discord:g:c", "msg1", "👍"),
      ).resolves.toBeUndefined();
    });

    it("removeReaction warns without throwing", async () => {
      const adapter = createDiscordAdapter(TEST_CONFIG);
      await expect(
        adapter.removeReaction("discord:g:c", "msg1", "👍"),
      ).resolves.toBeUndefined();
    });

    it("startTyping warns without throwing", async () => {
      const adapter = createDiscordAdapter(TEST_CONFIG);
      await expect(adapter.startTyping("discord:g:c")).resolves.toBeUndefined();
    });

    it("parseMessage throws", () => {
      const adapter = createDiscordAdapter(TEST_CONFIG);
      expect(() => adapter.parseMessage({})).toThrow("not supported");
    });
  });
});

describe("DiscordFormatConverter", () => {
  const converter = new DiscordFormatConverter();

  describe("renderPostable", () => {
    it("converts plain string with mention", () => {
      expect(converter.renderPostable("hello @user1")).toBe("hello <@user1>");
    });

    it("converts raw message with mention", () => {
      expect(converter.renderPostable({ raw: "hi @bot" })).toBe("hi <@bot>");
    });

    it("converts markdown message", () => {
      const result = converter.renderPostable({ markdown: "**bold text**" });
      expect(result).toContain("**bold text**");
    });

    it("converts AST message", () => {
      const ast = parseMarkdown("*italic*");
      const result = converter.renderPostable({ ast });
      expect(result).toContain("*italic*");
    });

    it("returns empty string for unrecognized message", () => {
      expect(converter.renderPostable({} as any)).toBe("");
    });
  });

  describe("toAst", () => {
    it("normalizes Discord user mentions", () => {
      const ast = converter.toAst("Hello <@123456>");
      const text = JSON.stringify(ast);
      expect(text).toContain("@123456");
      expect(text).not.toContain("<@123456>");
    });

    it("normalizes Discord channel mentions", () => {
      const ast = converter.toAst("See <#channel1>");
      const text = JSON.stringify(ast);
      expect(text).toContain("#channel1");
    });

    it("normalizes custom emoji", () => {
      const ast = converter.toAst("Emoji <:custom:12345>");
      const text = JSON.stringify(ast);
      expect(text).toContain(":custom:");
    });

    it("normalizes spoiler syntax", () => {
      const ast = converter.toAst("This is ||secret||");
      const text = JSON.stringify(ast);
      expect(text).toContain("spoiler");
    });
  });

  describe("fromAst", () => {
    it("converts bold", () => {
      const ast = parseMarkdown("**bold**");
      expect(converter.fromAst(ast)).toContain("**bold**");
    });

    it("converts italic", () => {
      const ast = parseMarkdown("*italic*");
      expect(converter.fromAst(ast)).toContain("*italic*");
    });

    it("converts strikethrough", () => {
      const ast = parseMarkdown("~~deleted~~");
      expect(converter.fromAst(ast)).toContain("~~deleted~~");
    });

    it("converts inline code", () => {
      const ast = parseMarkdown("use `code` here");
      expect(converter.fromAst(ast)).toContain("`code`");
    });

    it("converts code block", () => {
      const ast = parseMarkdown("```js\nconsole.log(1)\n```");
      const result = converter.fromAst(ast);
      expect(result).toContain("```js");
      expect(result).toContain("console.log(1)");
    });

    it("converts links", () => {
      const ast = parseMarkdown("[click](https://example.com)");
      expect(converter.fromAst(ast)).toContain("[click](https://example.com)");
    });

    it("converts blockquotes", () => {
      const ast = parseMarkdown("> quoted text");
      expect(converter.fromAst(ast)).toContain("> ");
    });

    it("converts mentions in text nodes", () => {
      const ast = parseMarkdown("hello @someone");
      expect(converter.fromAst(ast)).toContain("<@someone>");
    });

    it("converts list", () => {
      const ast = parseMarkdown("- item1\n- item2");
      const result = converter.fromAst(ast);
      expect(result).toContain("item1");
      expect(result).toContain("item2");
    });

    it("converts thematic break", () => {
      const ast = parseMarkdown("above\n\n---\n\nbelow");
      expect(converter.fromAst(ast)).toContain("---");
    });
  });
});

describe("cardToDiscordPayload", () => {
  it("converts card with title and subtitle", () => {
    const card: CardElement = {
      type: "card",
      title: "Test Title",
      subtitle: "Test Subtitle",
      children: [],
    };
    const result = cardToDiscordPayload(card);
    expect(result.embeds).toHaveLength(1);
    expect(result.embeds[0]!.title).toBe("Test Title");
    expect(result.embeds[0]!.description).toBe("Test Subtitle");
    expect(result.components).toEqual([]);
  });

  it("converts card with image", () => {
    const card: CardElement = {
      type: "card",
      imageUrl: "https://example.com/image.png",
      children: [],
    };
    const result = cardToDiscordPayload(card);
    expect(result.embeds[0]!.image).toEqual({
      url: "https://example.com/image.png",
    });
  });

  it("converts card with text children", () => {
    const card: CardElement = {
      type: "card",
      children: [
        { type: "text", content: "Hello world" } as any,
        { type: "text", content: "Bold text", style: "bold" } as any,
        { type: "text", content: "Muted text", style: "muted" } as any,
      ],
    };
    const result = cardToDiscordPayload(card);
    expect(result.embeds[0]!.description).toContain("Hello world");
    expect(result.embeds[0]!.description).toContain("**Bold text**");
    expect(result.embeds[0]!.description).toContain("*Muted text*");
  });

  it("appends text children to existing subtitle", () => {
    const card: CardElement = {
      type: "card",
      subtitle: "Subtitle",
      children: [{ type: "text", content: "Extra info" } as any],
    };
    const result = cardToDiscordPayload(card);
    expect(result.embeds[0]!.description).toContain("Subtitle");
    expect(result.embeds[0]!.description).toContain("Extra info");
  });

  it("converts card with divider", () => {
    const card: CardElement = {
      type: "card",
      children: [{ type: "divider" } as any],
    };
    const result = cardToDiscordPayload(card);
    expect(result.embeds[0]!.description).toContain("─");
  });

  it("converts card with fields", () => {
    const card: CardElement = {
      type: "card",
      children: [
        {
          type: "fields",
          children: [
            { label: "Name", value: "Alice" },
            { label: "Role", value: "Admin" },
          ],
        } as any,
      ],
    };
    const result = cardToDiscordPayload(card);
    expect(result.embeds[0]!.fields).toHaveLength(2);
    expect(result.embeds[0]!.fields![0]!.name).toBe("Name");
    expect(result.embeds[0]!.fields![0]!.value).toBe("Alice");
    expect(result.embeds[0]!.fields![0]!.inline).toBe(true);
  });

  it("converts card with link", () => {
    const card: CardElement = {
      type: "card",
      children: [
        { type: "link", label: "Click me", url: "https://example.com" } as any,
      ],
    };
    const result = cardToDiscordPayload(card);
    expect(result.embeds[0]!.description).toContain(
      "[Click me](https://example.com)",
    );
  });

  it("converts card with section containing text", () => {
    const card: CardElement = {
      type: "card",
      children: [
        {
          type: "section",
          children: [{ type: "text", content: "Section text" }],
        } as any,
      ],
    };
    const result = cardToDiscordPayload(card);
    expect(result.embeds[0]!.description).toContain("Section text");
  });

  it("converts card with actions (buttons)", () => {
    const card: CardElement = {
      type: "card",
      children: [
        {
          type: "actions",
          children: [
            { type: "button", id: "btn1", label: "OK", style: "primary" },
            { type: "button", id: "btn2", label: "Cancel", style: "danger" },
            { type: "button", id: "btn3", label: "Other" },
            {
              type: "link-button",
              label: "Visit",
              url: "https://example.com",
            },
          ],
        } as any,
      ],
    };
    const result = cardToDiscordPayload(card);
    expect(result.components).toHaveLength(1);
    expect(result.components[0]!.type).toBe(1); // Action Row
    expect(result.components[0]!.components).toHaveLength(4);
    expect(result.components[0]!.components[0]!.custom_id).toBe("btn1");
    expect(result.components[0]!.components[3]!.url).toBe(
      "https://example.com",
    );
  });

  it("converts card with disabled button", () => {
    const card: CardElement = {
      type: "card",
      children: [
        {
          type: "actions",
          children: [
            {
              type: "button",
              id: "btn1",
              label: "Disabled",
              disabled: true,
            },
          ],
        } as any,
      ],
    };
    const result = cardToDiscordPayload(card);
    expect(result.components[0]!.components[0]!.disabled).toBe(true);
  });

  it("ignores image children", () => {
    const card: CardElement = {
      type: "card",
      children: [{ type: "image", url: "https://example.com/img.png" } as any],
    };
    const result = cardToDiscordPayload(card);
    // Image children are skipped, no description added
    expect(result.embeds[0]!.description).toBeUndefined();
  });
});

describe("cardToFallbackText", () => {
  it("generates fallback with title and subtitle", () => {
    const card: CardElement = {
      type: "card",
      title: "Title",
      subtitle: "Subtitle",
      children: [],
    };
    const result = cardToFallbackText(card);
    expect(result).toContain("**Title**");
    expect(result).toContain("Subtitle");
  });

  it("generates fallback with text children", () => {
    const card: CardElement = {
      type: "card",
      children: [{ type: "text", content: "Hello" } as any],
    };
    expect(cardToFallbackText(card)).toContain("Hello");
  });

  it("generates fallback with fields", () => {
    const card: CardElement = {
      type: "card",
      children: [
        {
          type: "fields",
          children: [{ label: "Key", value: "Value" }],
        } as any,
      ],
    };
    const result = cardToFallbackText(card);
    expect(result).toContain("**Key**");
    expect(result).toContain("Value");
  });

  it("returns empty for actions", () => {
    const card: CardElement = {
      type: "card",
      children: [
        {
          type: "actions",
          children: [{ type: "button", id: "btn1", label: "OK" }],
        } as any,
      ],
    };
    // Actions should not produce text
    expect(cardToFallbackText(card)).toBe("");
  });

  it("generates fallback with divider", () => {
    const card: CardElement = {
      type: "card",
      children: [{ type: "divider" } as any],
    };
    expect(cardToFallbackText(card)).toContain("---");
  });

  it("generates fallback with section", () => {
    const card: CardElement = {
      type: "card",
      children: [
        {
          type: "section",
          children: [{ type: "text", content: "In section" }],
        } as any,
      ],
    };
    expect(cardToFallbackText(card)).toContain("In section");
  });
});
