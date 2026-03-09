import {
  InteractionType,
  InteractionResponseType,
  type APIInteraction,
  type APIChatInputApplicationCommandInteraction,
  type APIMessageComponentInteraction,
} from "discord-api-types/v10";
import { verifyKey } from "discord-interactions";
import { DEFAULT_LOCALE } from "./agent/prompt";
import { patchDiscordResponse } from "./discord/api";
import { handleFeedbackInteraction } from "./discord/feedback";
import { getStringOption } from "./discord/helpers";

async function verifySignature(
  request: Request,
  env: Env,
): Promise<{ valid: true; body: string } | { valid: false }> {
  const bodyBuffer = await request.arrayBuffer();
  const bodyBytes = new Uint8Array(bodyBuffer);

  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");

  if (!(signature && timestamp)) {
    return { valid: false };
  }

  try {
    const isValid = await verifyKey(
      bodyBytes,
      signature,
      timestamp,
      env.DISCORD_PUBLIC_KEY,
    );
    if (!isValid) return { valid: false };
  } catch {
    return { valid: false };
  }

  return { valid: true, body: new TextDecoder().decode(bodyBytes) };
}

export async function handleDiscordWebhook(
  request: Request,
  ctx: Pick<ExecutionContext, "waitUntil">,
  env: Env,
): Promise<Response> {
  const verification = await verifySignature(request, env);
  if (!verification.valid) {
    return new Response("Invalid signature", { status: 401 });
  }

  let interaction: APIInteraction;
  try {
    interaction = JSON.parse(verification.body) as APIInteraction;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (interaction.type === InteractionType.Ping) {
    return Response.json({ type: InteractionResponseType.Pong });
  }

  if (interaction.type === InteractionType.ApplicationCommand) {
    ctx.waitUntil(
      handleApplicationCommand(
        interaction as APIChatInputApplicationCommandInteraction,
        env,
      ),
    );
    return Response.json({
      type: InteractionResponseType.DeferredChannelMessageWithSource,
    });
  }

  if (interaction.type === InteractionType.MessageComponent) {
    const { response, pending } = handleFeedbackInteraction(
      interaction as APIMessageComponentInteraction,
      env,
    );
    if (pending) {
      ctx.waitUntil(pending);
    }
    return response;
  }

  return new Response("Unknown interaction type", { status: 400 });
}

async function handleApplicationCommand(
  interaction: APIChatInputApplicationCommandInteraction,
  env: Env,
): Promise<void> {
  const commandName = interaction.data?.name;

  if (commandName === "ask") {
    await handleAskCommand(interaction, env);
  }
}

async function handleAskCommand(
  interaction: APIChatInputApplicationCommandInteraction,
  env: Env,
): Promise<void> {
  const question = getStringOption(interaction, "question");
  const interactionId = interaction.id;
  const interactionToken = interaction.token;
  const applicationId = env.DISCORD_APPLICATION_ID;
  const locale = interaction.locale ?? DEFAULT_LOCALE;
  const userId = interaction.member?.user?.id ?? interaction.user?.id ?? "";

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
      locale,
      userId,
    },
  });
}
