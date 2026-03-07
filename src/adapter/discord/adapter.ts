import { AsyncLocalStorage } from "node:async_hooks";
import {
  type Adapter,
  type AdapterPostableMessage,
  type ChatInstance,
  type WebhookOptions,
  type RawMessage,
  type EmojiValue,
  type FetchOptions,
  type FetchResult,
  type ThreadInfo,
  type Message,
  type FormattedContent,
  convertEmojiPlaceholders,
} from "chat";
import {
  extractCard,
  extractFiles,
  ValidationError,
} from "@chat-adapter/shared";
import { InteractionType } from "discord-api-types/v10";
import {
  InteractionResponseType as DiscordInteractionResponseType,
  verifyKey,
} from "discord-interactions";
import {
  DiscordFormatConverter,
  cardToDiscordPayload,
  cardToFallbackText,
} from "./format";

export interface DiscordAdapterConfig {
  applicationId: string;
  botToken: string;
  publicKey: string;
}

export interface DiscordThreadId {
  channelId: string;
  guildId: string;
  threadId?: string;
}

interface SlashCommandContext {
  channelId: string;
  interactionToken: string;
  initialResponseSent: boolean;
}

interface RequestStore {
  slashCommand?: SlashCommandContext;
}

const DISCORD_API_BASE = "https://discord.com/api/v10";
const DISCORD_MAX_CONTENT_LENGTH = 2000;

const InteractionResponseType = {
  DeferredChannelMessageWithSource: 5,
  DeferredUpdateMessage: 6,
} as const;

export class DiscordAdapter implements Adapter<DiscordThreadId, unknown> {
  readonly name = "discord";
  readonly userName: string;
  readonly botUserId?: string;

  private readonly botToken: string;
  private readonly publicKey: string;
  private readonly applicationId: string;
  private chat: ChatInstance | null = null;
  private readonly formatConverter = new DiscordFormatConverter();
  private readonly requestContext = new AsyncLocalStorage<RequestStore>();

  constructor(config: DiscordAdapterConfig) {
    this.botToken = config.botToken;
    this.publicKey = config.publicKey.trim().toLowerCase();
    this.applicationId = config.applicationId;
    this.botUserId = config.applicationId;
    this.userName = "bot";
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
  }

  async handleWebhook(
    request: Request,
    options?: WebhookOptions,
  ): Promise<Response> {
    const bodyBuffer = await request.arrayBuffer();
    const bodyBytes = new Uint8Array(bodyBuffer);
    const body = new TextDecoder().decode(bodyBytes);

    const signature = request.headers.get("x-signature-ed25519");
    const timestamp = request.headers.get("x-signature-timestamp");

    if (!(signature && timestamp)) {
      return new Response("Invalid signature", { status: 401 });
    }

    let isValid: boolean;
    try {
      isValid = await verifyKey(
        bodyBytes,
        signature,
        timestamp,
        this.publicKey,
      );
    } catch {
      return new Response("Invalid signature", { status: 401 });
    }

    if (!isValid) {
      return new Response("Invalid signature", { status: 401 });
    }

    let interaction: Record<string, unknown>;
    try {
      interaction = JSON.parse(body);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    if (interaction.type === InteractionType.Ping) {
      return Response.json({ type: DiscordInteractionResponseType.PONG });
    }

    if (interaction.type === InteractionType.MessageComponent) {
      this.handleComponentInteraction(interaction, options);
      return Response.json({
        type: InteractionResponseType.DeferredUpdateMessage,
      });
    }

    if (interaction.type === InteractionType.ApplicationCommand) {
      this.handleApplicationCommandInteraction(interaction, options);
      return Response.json({
        type: InteractionResponseType.DeferredChannelMessageWithSource,
      });
    }

    return new Response("Unknown interaction type", { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleComponentInteraction(
    interaction: any,
    options?: WebhookOptions,
  ): void {
    if (!this.chat) return;

    const customId = interaction.data?.custom_id;
    if (!customId) return;

    const user = interaction.member?.user || interaction.user;
    if (!user) return;

    const interactionChannelId = interaction.channel_id;
    const guildId = interaction.guild_id || "@me";
    const messageId = interaction.message?.id;
    if (!(interactionChannelId && messageId)) return;

    const channel = interaction.channel;
    const isThread = channel?.type === 11 || channel?.type === 12;
    const parentChannelId =
      isThread && channel?.parent_id ? channel.parent_id : interactionChannelId;

    const threadId = isThread
      ? this.encodeThreadId({
          guildId,
          channelId: parentChannelId,
          threadId: interactionChannelId,
        })
      : this.encodeThreadId({ guildId, channelId: interactionChannelId });

    this.chat.processAction(
      {
        actionId: customId,
        value: customId,
        user: {
          userId: user.id,
          userName: user.username,
          fullName: user.global_name || user.username,
          isBot: user.bot ?? false,
          isMe: false,
        },
        messageId,
        threadId,
        adapter: this,
        raw: interaction,
      },
      options,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleApplicationCommandInteraction(
    interaction: any,
    options?: WebhookOptions,
  ): void {
    if (!this.chat) return;

    const commandName = interaction.data?.name;
    if (!commandName) return;

    const user = interaction.member?.user || interaction.user;
    if (!user) return;

    const interactionChannelId = interaction.channel_id;
    if (!interactionChannelId) return;

    const guildId = interaction.guild_id || "@me";
    const channel = interaction.channel;
    const isThread = channel?.type === 11 || channel?.type === 12;
    const parentChannelId =
      isThread && channel?.parent_id ? channel.parent_id : interactionChannelId;

    const channelId = isThread
      ? this.encodeThreadId({
          guildId,
          channelId: parentChannelId,
          threadId: interactionChannelId,
        })
      : this.encodeThreadId({ guildId, channelId: interactionChannelId });

    const { command, text } = this.parseSlashCommand(
      commandName,
      interaction.data?.options,
    );

    this.requestContext.run(
      {
        slashCommand: {
          channelId,
          interactionToken: interaction.token,
          initialResponseSent: false,
        },
      },
      () => {
        this.chat?.processSlashCommand(
          {
            command,
            text,
            user: {
              userId: user.id,
              userName: user.username,
              fullName: user.global_name || user.username,
              isBot: user.bot ?? false,
              isMe: user.id === this.applicationId,
            },
            adapter: this,
            raw: interaction,
            channelId,
          },
          options,
        );
      },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseSlashCommand(
    name: string,
    options?: any[],
  ): { command: string; text: string } {
    const commandParts = [name.startsWith("/") ? name : `/${name}`];
    const valueParts: string[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const collect = (items: any[]) => {
      for (const option of items) {
        if (option.value !== undefined) {
          valueParts.push(String(option.value));
          continue;
        }
        if (option.options && option.options.length > 0) {
          commandParts.push(option.name);
          collect(option.options);
        }
      }
    };

    if (options && options.length > 0) {
      collect(options);
    }

    return {
      command: commandParts.join(" "),
      text: valueParts.join(" ").trim(),
    };
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<unknown>> {
    let { channelId, threadId: discordThreadId } =
      this.decodeThreadId(threadId);
    const actualThreadId = threadId;

    if (discordThreadId) {
      channelId = discordThreadId;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: any = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const embeds: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const components: any[] = [];

    const card = extractCard(message);
    if (card) {
      const cardPayload = cardToDiscordPayload(card);
      embeds.push(...cardPayload.embeds);
      components.push(...cardPayload.components);
      payload.content = this.truncateContent(cardToFallbackText(card));
    } else {
      payload.content = this.truncateContent(
        convertEmojiPlaceholders(
          this.formatConverter.renderPostable(message),
          "discord",
        ),
      );
    }

    if (embeds.length > 0) payload.embeds = embeds;
    if (components.length > 0) payload.components = components;

    const files = extractFiles(message);
    const slashResponse = this.tryPostSlashResponse(
      actualThreadId,
      payload,
      files,
    );
    if (slashResponse) return slashResponse;

    // Regular channel post (with bot token)
    const response = await this.discordFetch(
      `/channels/${channelId}/messages`,
      "POST",
      payload,
    );
    const result: any = await response.json();
    return { id: result.id, threadId: actualThreadId, raw: result };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private tryPostSlashResponse(
    threadId: string,
    payload: any,
    files: any[],
  ): Promise<RawMessage<unknown>> | undefined {
    const slashContext = this.requestContext.getStore()?.slashCommand;
    if (!slashContext || slashContext.channelId !== threadId) return undefined;
    return this.postSlashCommandResponse(
      slashContext,
      threadId,
      payload,
      files,
    );
  }

  private async postSlashCommandResponse(
    slashContext: SlashCommandContext,
    threadId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    payload: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _files: any[],
  ): Promise<RawMessage<unknown>> {
    const isInitialResponse = !slashContext.initialResponseSent;
    slashContext.initialResponseSent = true;

    const path = isInitialResponse
      ? `/webhooks/${this.applicationId}/${slashContext.interactionToken}/messages/@original`
      : `/webhooks/${this.applicationId}/${slashContext.interactionToken}?wait=true`;
    const method = isInitialResponse ? "PATCH" : "POST";

    const response = await this.discordInteractionFetch(path, method, payload);
    const result: any = await response.json();
    return { id: result.id, threadId, raw: result };
  }

  private truncateContent(content: string): string {
    if (content.length <= DISCORD_MAX_CONTENT_LENGTH) return content;
    return `${content.slice(0, DISCORD_MAX_CONTENT_LENGTH - 3)}...`;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async discordInteractionFetch(
    path: string,
    method: string,
    body?: any,
  ): Promise<Response> {
    const response = await fetch(`${DISCORD_API_BASE}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Discord interaction API error: ${response.status} ${errorText}`,
      );
    }
    return response;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async discordFetch(
    path: string,
    method: string,
    body?: any,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bot ${this.botToken}`,
    };
    if (body) headers["Content-Type"] = "application/json";

    const response = await fetch(`${DISCORD_API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Discord API error: ${response.status} ${errorText}`);
    }
    return response;
  }

  encodeThreadId(platformData: DiscordThreadId): string {
    const threadPart = platformData.threadId ? `:${platformData.threadId}` : "";
    return `discord:${platformData.guildId}:${platformData.channelId}${threadPart}`;
  }

  decodeThreadId(threadId: string): DiscordThreadId {
    const parts = threadId.split(":");
    if (parts.length < 3 || parts[0] !== "discord") {
      throw new ValidationError(
        "discord",
        `Invalid Discord thread ID: ${threadId}`,
      );
    }
    return {
      guildId: parts[1]!,
      channelId: parts[2]!,
      threadId: parts[3],
    };
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  isDM(threadId: string): boolean {
    const { guildId } = this.decodeThreadId(threadId);
    return guildId === "@me";
  }

  // --- Unsupported methods (webhook-only mode) ---

  async editMessage(
    _threadId: string,
    _messageId: string,
    _message: AdapterPostableMessage,
  ): Promise<RawMessage<unknown>> {
    console.warn(
      "DiscordAdapter: editMessage is not supported in webhook-only mode",
    );
    return { id: "", threadId: _threadId, raw: {} };
  }

  async deleteMessage(_threadId: string, _messageId: string): Promise<void> {
    console.warn(
      "DiscordAdapter: deleteMessage is not supported in webhook-only mode",
    );
  }

  async addReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string,
  ): Promise<void> {
    console.warn(
      "DiscordAdapter: addReaction is not supported in webhook-only mode",
    );
  }

  async removeReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string,
  ): Promise<void> {
    console.warn(
      "DiscordAdapter: removeReaction is not supported in webhook-only mode",
    );
  }

  async startTyping(_threadId: string): Promise<void> {
    console.warn(
      "DiscordAdapter: startTyping is not supported in webhook-only mode",
    );
  }

  async fetchMessages(
    _threadId: string,
    _options?: FetchOptions,
  ): Promise<FetchResult<unknown>> {
    console.warn(
      "DiscordAdapter: fetchMessages is not supported in webhook-only mode",
    );
    return { messages: [], nextCursor: undefined };
  }

  async fetchThread(_threadId: string): Promise<ThreadInfo> {
    console.warn(
      "DiscordAdapter: fetchThread is not supported in webhook-only mode",
    );
    return {
      id: _threadId,
      channelId: "",
      channelName: "",
      isDM: false,
      metadata: {},
    };
  }

  parseMessage(_raw: unknown): Message<unknown> {
    throw new Error(
      "DiscordAdapter: parseMessage is not supported in webhook-only mode",
    );
  }
}

export function createDiscordAdapter(
  config: DiscordAdapterConfig,
): DiscordAdapter {
  return new DiscordAdapter(config);
}
