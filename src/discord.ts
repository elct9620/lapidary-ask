import { InteractionType } from "discord-api-types/v10";
import { verifyKey } from "discord-interactions";
import { patchDiscordResponse } from "./discord/api";
import { getStringOption } from "./discord/helpers";

interface DiscordInteraction {
  type: number;
  id: string;
  token: string;
  data?: {
    name: string;
    options?: Array<{
      name: string;
      type: number;
      value?: string | number | boolean;
    }>;
  };
}

export async function handleDiscordWebhook(
  request: Request,
  ctx: ExecutionContext,
  env: Env,
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
      env.DISCORD_PUBLIC_KEY,
    );
  } catch {
    return new Response("Invalid signature", { status: 401 });
  }

  if (!isValid) {
    return new Response("Invalid signature", { status: 401 });
  }

  let interaction: DiscordInteraction;
  try {
    interaction = JSON.parse(body) as DiscordInteraction;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (interaction.type === InteractionType.Ping) {
    return Response.json({ type: 1 }); // PONG
  }

  if (interaction.type === InteractionType.ApplicationCommand) {
    ctx.waitUntil(handleApplicationCommand(interaction, env));
    return Response.json({ type: 5 }); // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
  }

  return new Response("Unknown interaction type", { status: 400 });
}

async function handleApplicationCommand(
  interaction: DiscordInteraction,
  env: Env,
): Promise<void> {
  const commandName = interaction.data?.name;

  if (commandName === "ask") {
    await handleAskCommand(interaction, env);
  }
}

async function handleAskCommand(
  interaction: DiscordInteraction,
  env: Env,
): Promise<void> {
  const question = getStringOption(interaction, "question");
  const interactionId = interaction.id;
  const interactionToken = interaction.token;
  const applicationId = env.DISCORD_APPLICATION_ID;

  if (!question) {
    await patchDiscordResponse(applicationId, interactionToken, {
      content: "Please provide a question.",
    });
    return;
  }

  await env.ASK_WORKFLOW.create({
    id: interactionId,
    params: {
      question,
      interactionToken,
      applicationId,
    },
  });
}
