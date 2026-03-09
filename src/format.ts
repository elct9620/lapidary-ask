const DISCORD_MAX_CONTENT_LENGTH = 2000;

const GFM_TABLE_REGEX =
  /(?:^|\n)((?:\|[^\n]*\|\r?\n)+\|[\s:|-]*\|\r?\n(?:\|[^\n]*\|\r?\n?)*)/g;

export function formatForDiscord(text: string): string {
  let result = text.replace(GFM_TABLE_REGEX, (match) => {
    const trimmed = match.startsWith("\n") ? match.slice(1) : match;
    return `\n\`\`\`\n${trimmed.trimEnd()}\n\`\`\`\n`;
  });

  if (result.length > DISCORD_MAX_CONTENT_LENGTH) {
    let truncated = result.slice(0, DISCORD_MAX_CONTENT_LENGTH - 3);
    const lastCode = truncated.charCodeAt(truncated.length - 1);
    if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
      truncated = truncated.slice(0, -1);
    }
    result = `${truncated}...`;
  }

  return result;
}
