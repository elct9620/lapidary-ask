const DISCORD_MAX_CONTENT_LENGTH = 2000;

const GFM_TABLE_REGEX =
  /(?:^|\n)((?:\|[^\n]*\|\r?\n)+\|[\s:|-]*\|\r?\n(?:\|[^\n]*\|\r?\n?)*)/g;

export function formatForDiscord(text: string): string {
  let result = text.replace(GFM_TABLE_REGEX, (match) => {
    const trimmed = match.startsWith("\n") ? match.slice(1) : match;
    return `\n\`\`\`\n${trimmed.trimEnd()}\n\`\`\`\n`;
  });

  if (result.length > DISCORD_MAX_CONTENT_LENGTH) {
    result = `${result.slice(0, DISCORD_MAX_CONTENT_LENGTH - 3)}...`;
  }

  return result;
}
