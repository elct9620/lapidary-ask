import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { commands } from "../src/commands";

function loadDevVars(): Record<string, string> {
  const varsPath = resolve(process.cwd(), ".dev.vars");
  const content = readFileSync(varsPath, "utf-8");
  const vars: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    vars[key] = value;
  }
  return vars;
}

async function main() {
  const clear = process.argv.includes("--clear");
  const vars = loadDevVars();

  const applicationId = vars.DISCORD_APPLICATION_ID;
  const botToken = vars.DISCORD_BOT_TOKEN;

  if (!applicationId || !botToken) {
    console.error(
      "Missing DISCORD_APPLICATION_ID or DISCORD_BOT_TOKEN in .dev.vars",
    );
    process.exit(1);
  }

  const url = `https://discord.com/api/v10/applications/${applicationId}/commands`;
  const body = clear ? [] : commands;

  console.log(
    clear
      ? "Clearing all slash commands..."
      : `Registering ${commands.length} slash command(s)...`,
  );

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bot ${botToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`Failed (${response.status}): ${text}`);
    process.exit(1);
  }

  const result = await response.json();
  console.log("Success:", JSON.stringify(result, null, 2));
}

main();
