import {
  BaseFormatConverter,
  type AdapterPostableMessage,
  type Root,
  getNodeChildren,
  isBlockquoteNode,
  isCodeNode,
  isDeleteNode,
  isEmphasisNode,
  isInlineCodeNode,
  isLinkNode,
  isListNode,
  isParagraphNode,
  isStrongNode,
  isTableNode,
  isTextNode,
  parseMarkdown,
  tableToAscii,
  convertEmojiPlaceholders,
  cardChildToFallbackText,
  tableElementToAscii,
  type CardElement,
} from "chat";
import { renderGfmTable } from "@chat-adapter/shared";
import { type APIEmbed, ButtonStyle } from "discord-api-types/v10";

function convertEmoji(text: string): string {
  return convertEmojiPlaceholders(text, "discord");
}

interface DiscordButton {
  type: 2;
  style: ButtonStyle;
  label?: string;
  custom_id?: string;
  url?: string;
  disabled?: boolean;
}

interface DiscordActionRow {
  type: 1;
  components: DiscordButton[];
}

function cardToDiscordPayload(card: CardElement): {
  embeds: APIEmbed[];
  components: DiscordActionRow[];
} {
  const embed: APIEmbed = {};
  const fields: APIEmbed["fields"] = [];
  const components: DiscordActionRow[] = [];

  if (card.title) {
    embed.title = convertEmoji(card.title);
  }
  if (card.subtitle) {
    embed.description = convertEmoji(card.subtitle);
  }
  if (card.imageUrl) {
    embed.image = { url: card.imageUrl };
  }
  embed.color = 0x586bf2;

  const textParts: string[] = [];
  for (const child of card.children) {
    processChild(child, textParts, fields!, components);
  }

  if (textParts.length > 0) {
    if (embed.description) {
      embed.description += `\n\n${textParts.join("\n\n")}`;
    } else {
      embed.description = textParts.join("\n\n");
    }
  }

  if (fields!.length > 0) {
    embed.fields = fields;
  }

  return { embeds: [embed], components };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function processChild(
  child: any,
  textParts: string[],
  fields: NonNullable<APIEmbed["fields"]>,
  components: DiscordActionRow[],
): void {
  switch (child.type) {
    case "text":
      textParts.push(convertTextElement(child));
      break;
    case "image":
      break;
    case "divider":
      textParts.push("───────────");
      break;
    case "actions":
      components.push(...convertActionsToRows(child));
      break;
    case "section":
      for (const c of child.children) {
        processChild(c, textParts, fields, components);
      }
      break;
    case "fields":
      for (const field of child.children) {
        fields.push({
          name: convertEmoji(field.label),
          value: convertEmoji(field.value),
          inline: true,
        });
      }
      break;
    case "link":
      textParts.push(`[${convertEmoji(child.label)}](${child.url})`);
      break;
    case "table":
      textParts.push(renderGfmTable(child).join("\n"));
      break;
    default: {
      const text = cardChildToFallbackText(child);
      if (text) {
        textParts.push(text);
      }
      break;
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertTextElement(element: any): string {
  let text = convertEmoji(element.content);
  if (element.style === "bold") {
    text = `**${text}**`;
  } else if (element.style === "muted") {
    text = `*${text}*`;
  }
  return text;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertActionsToRows(element: any): DiscordActionRow[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buttons: DiscordButton[] = element.children
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((c: any) => c.type === "button" || c.type === "link-button")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((button: any) => {
      if (button.type === "link-button") {
        return {
          type: 2 as const,
          style: ButtonStyle.Link,
          label: button.label,
          url: button.url,
        };
      }
      const style =
        button.style === "primary"
          ? ButtonStyle.Primary
          : button.style === "danger"
            ? ButtonStyle.Danger
            : ButtonStyle.Secondary;
      const db: DiscordButton = {
        type: 2,
        style,
        label: button.label,
        custom_id: button.id,
      };
      if (button.disabled) db.disabled = true;
      return db;
    });

  const rows: DiscordActionRow[] = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push({ type: 1, components: buttons.slice(i, i + 5) });
  }
  return rows;
}

function cardToFallbackText(card: CardElement): string {
  const parts: string[] = [];
  if (card.title) parts.push(`**${convertEmoji(card.title)}**`);
  if (card.subtitle) parts.push(convertEmoji(card.subtitle));
  for (const child of card.children) {
    const text = childToFallbackText(child);
    if (text) parts.push(text);
  }
  return parts.join("\n\n");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function childToFallbackText(child: any): string | null {
  switch (child.type) {
    case "text":
      return convertEmoji(child.content);
    case "fields":
      return (
        child.children
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map(
            (f: any) =>
              `**${convertEmoji(f.label)}**: ${convertEmoji(f.value)}`,
          )
          .join("\n")
      );
    case "actions":
      return null;
    case "section":
      return (
        child.children
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((c: any) => childToFallbackText(c))
          .filter(Boolean)
          .join("\n")
      );
    case "table":
      return `\`\`\`\n${tableElementToAscii(child.headers, child.rows)}\n\`\`\``;
    case "divider":
      return "---";
    default:
      return cardChildToFallbackText(child);
  }
}

class DiscordFormatConverter extends BaseFormatConverter {
  private convertMentionsToDiscord(text: string): string {
    return text.replace(/@(\w+)/g, "<@$1>");
  }

  renderPostable(message: AdapterPostableMessage): string {
    if (typeof message === "string") {
      return this.convertMentionsToDiscord(message);
    }
    if ("raw" in message) {
      return this.convertMentionsToDiscord(message.raw);
    }
    if ("markdown" in message) {
      return this.fromAst(parseMarkdown(message.markdown));
    }
    if ("ast" in message) {
      return this.fromAst(message.ast);
    }
    return "";
  }

  fromAst(ast: Root): string {
    return this.fromAstWithNodeConverter(ast, (node) =>
      this.nodeToDiscordMarkdown(node),
    );
  }

  toAst(discordMarkdown: string): Root {
    let markdown = discordMarkdown;
    markdown = markdown.replace(/<@!?(\w+)>/g, "@$1");
    markdown = markdown.replace(/<#(\w+)>/g, "#$1");
    markdown = markdown.replace(/<@&(\w+)>/g, "@&$1");
    markdown = markdown.replace(/<a?:(\w+):\d+>/g, ":$1:");
    markdown = markdown.replace(/\|\|([^|]+)\|\|/g, "[spoiler: $1]");
    return parseMarkdown(markdown);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private nodeToDiscordMarkdown(node: any): string {
    if (isParagraphNode(node)) {
      return getNodeChildren(node)
        .map((child) => this.nodeToDiscordMarkdown(child))
        .join("");
    }
    if (isTextNode(node)) {
      return node.value.replace(/@(\w+)/g, "<@$1>");
    }
    if (isStrongNode(node)) {
      const content = getNodeChildren(node)
        .map((child) => this.nodeToDiscordMarkdown(child))
        .join("");
      return `**${content}**`;
    }
    if (isEmphasisNode(node)) {
      const content = getNodeChildren(node)
        .map((child) => this.nodeToDiscordMarkdown(child))
        .join("");
      return `*${content}*`;
    }
    if (isDeleteNode(node)) {
      const content = getNodeChildren(node)
        .map((child) => this.nodeToDiscordMarkdown(child))
        .join("");
      return `~~${content}~~`;
    }
    if (isInlineCodeNode(node)) {
      return `\`${node.value}\``;
    }
    if (isCodeNode(node)) {
      return `\`\`\`${node.lang || ""}\n${node.value}\n\`\`\``;
    }
    if (isLinkNode(node)) {
      const linkText = getNodeChildren(node)
        .map((child) => this.nodeToDiscordMarkdown(child))
        .join("");
      return `[${linkText}](${node.url})`;
    }
    if (isBlockquoteNode(node)) {
      return getNodeChildren(node)
        .map((child) => `> ${this.nodeToDiscordMarkdown(child)}`)
        .join("\n");
    }
    if (isListNode(node)) {
      return this.renderList(node, 0, (child) =>
        this.nodeToDiscordMarkdown(child),
      );
    }
    if (node.type === "break") {
      return "\n";
    }
    if (node.type === "thematicBreak") {
      return "---";
    }
    if (isTableNode(node)) {
      return `\`\`\`\n${tableToAscii(node)}\n\`\`\``;
    }
    return this.defaultNodeToText(node, (child) =>
      this.nodeToDiscordMarkdown(child),
    );
  }
}

export {
  DiscordFormatConverter,
  cardToDiscordPayload,
  cardToFallbackText,
  type DiscordActionRow,
};
