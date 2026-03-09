import {
  InteractionType,
  InteractionResponseType,
  type APIInteraction,
  type APIChatInputApplicationCommandInteraction,
  type APIMessageComponentInteraction,
} from "discord-api-types/v10";
import { verifyKey } from "discord-interactions";
import { DEFAULT_LOCALE } from "./agent/prompt";
import { createContainer } from "./container";
import { handleFeedbackInteraction } from "./discord/feedback";
import { getStringOption } from "./discord/helpers";

async function verifySignature(
  request: Request,
  discordPublicKey: string,
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
      discordPublicKey,
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
): Promise<Response> {
  const container = createContainer();
  const verification = await verifySignature(
    request,
    container.discordPublicKey,
  );
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
        container,
      ),
    );
    return Response.json({
      type: InteractionResponseType.DeferredChannelMessageWithSource,
    });
  }

  if (interaction.type === InteractionType.MessageComponent) {
    const { response, pending } = handleFeedbackInteraction(
      interaction as APIMessageComponentInteraction,
      container,
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
  container: ReturnType<typeof createContainer>,
): Promise<void> {
  const commandName = interaction.data?.name;

  if (commandName === "ask") {
    await handleAskCommand(interaction, container);
  }
}

async function handleAskCommand(
  interaction: APIChatInputApplicationCommandInteraction,
  container: ReturnType<typeof createContainer>,
): Promise<void> {
  const question = getStringOption(interaction, "question");
  const interactionId = interaction.id;
  const interactionToken = interaction.token;
  const locale = interaction.locale ?? DEFAULT_LOCALE;
  const userId = interaction.member?.user?.id ?? interaction.user?.id ?? "";

  if (!question) {
    await container.patchDiscordResponse(interactionToken, {
      content: "Please provide a question.",
    });
    return;
  }

  await container.askWorkflow.create({
    id: interactionId,
    params: {
      question,
      interactionToken,
      locale,
      userId,
    },
  });
}
