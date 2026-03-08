# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Lapidary Ask Bot is a Discord bot deployed on Cloudflare Workers that lets Ruby community members query the Lapidary Knowledge Graph via a `/ask` slash command. It uses an LLM (via OpenRouter) with tool calling to search nodes and relationships between Rubyists and Ruby core modules/standard libraries.

See `SPEC.md` for the full specification.

## Commands

| Task                      | Command                                 |
| ------------------------- | --------------------------------------- |
| Dev server                | `pnpm dev`                              |
| Deploy                    | `pnpm deploy`                           |
| Run all tests             | `pnpm test`                             |
| Watch tests               | `pnpm test:watch`                       |
| Run single test           | `pnpm vitest run tests/example.test.ts` |
| Format code               | `pnpm format`                           |
| Check formatting          | `pnpm format:check`                     |
| Generate CF types         | `pnpm cf-typegen`                       |
| Register Discord commands | `pnpm register`                         |
| Clear Discord commands    | `pnpm register:clear`                   |

Discord command registration reads credentials from `.dev.vars` file.

## Architecture

The project follows a layered architecture under `src/`:

- **Entry point**: `src/index.tsx` — Hono app with health check (`GET /`) and Discord webhook (`POST /api/webhooks/discord`)
- **Discord layer**: `src/discord.ts` — Webhook signature verification, interaction routing, deferred response via Cloudflare Workflow
  - `src/discord/api.ts` — `patchDiscordResponse()` helper for Discord API calls
  - `src/discord/helpers.ts` — Extracts typed options from slash command interactions
- **Workflow**: `src/workflows/ask.ts` — `AskWorkflow` (Cloudflare Workflow) orchestrates guardrails check, LLM call, and Discord response with retries
- **Agent (LLM)**: `src/agent/` — LLM integration layer
  - `client.ts` — `askLLM()` using Vercel AI SDK with OpenRouter (`openrouter/free`)
  - `guardrails.ts` — `checkGuardrails()` lightweight relevance classifier (fail-open on error)
  - `tools.ts` — AI SDK tool definitions (`searchNodes`, `getNeighbors`) for querying Lapidary Knowledge Graph via `INTERNAL_API` service binding
  - `prompt.ts` — Locale-aware system prompt builder (maps Discord locale to response language)
  - `telemetry-helpers.ts` — `buildTelemetryConfig()` helper for AI SDK telemetry integration
- **Telemetry**: `src/telemetry/` — Three-layer Langfuse integration (see below)
- **Formatting**: `src/format.ts` — Wraps GFM tables in code blocks for Discord, truncates to 2000 chars
- **Command definitions**: `src/commands.ts` — Discord slash command registration metadata (with zh-TW and ja localizations)
- **Registration script**: `scripts/register.ts` — Registers/clears slash commands via Discord API

### Request Flow

1. Discord sends webhook → Hono route → `handleDiscordWebhook()`
2. Verifies Ed25519 signature, defers response (ACK), spawns `AskWorkflow`
3. `AskWorkflow.run()` runs guardrails check; if rejected, replies with rejection reason
4. If relevant, calls `askLLM()` with tools (max 15 steps)
5. Tools query Lapidary Knowledge Graph via VPC service binding
6. Response patched back via Discord interaction webhook

### Cloudflare Workflows

`step.do()` calls must be `await`-ed directly inside the `run()` method. The callback logic can be extracted to private methods on the Workflow class — only the `step.do()` invocation itself must remain in `run()`.

### Telemetry Architecture

`src/telemetry/` follows a three-layer design with unidirectional dependency flow (Integration → Tracer → Client):

| Layer           | File             | Responsibility                                                                                                                |
| --------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Client**      | `client.ts`      | Event buffer + Langfuse REST API batch ingestion                                                                              |
| **Tracer**      | `tracer.ts`      | Semantic event creation (`createTrace`, `createGeneration`, `createTool`, `createGuardrail`) and trace ID lifecycle           |
| **Integration** | `integration.ts` | Implements Vercel AI SDK `TelemetryIntegration` hooks (`onStart`, `onStepStart/Finish`, `onToolCallStart/Finish`, `onFinish`) |

The workflow creates a single trace spanning both guardrails and LLM steps by passing `traceId` from the guardrails step to the LLM step via `tracer.setTraceId()`.

## Testing

Tests use Vitest with `@cloudflare/vitest-pool-workers` to run in a Workers-like environment. Coverage uses Istanbul provider. Test files go in `tests/` directory. Config references `wrangler.jsonc` for worker pool options.

The `vitest.config.ts` configures SSR optimization for `discord-api-types` and `discord-interactions` packages to work in the Workers environment.

Workflow tests use `introspectWorkflowInstance` with `mockStepResult`/`mockStepError` to test step orchestration without executing actual callbacks.

## Key Bindings

| Binding                  | Type            | Purpose                            |
| ------------------------ | --------------- | ---------------------------------- |
| `DISCORD_BOT_TOKEN`      | Secret          | Discord bot auth                   |
| `DISCORD_PUBLIC_KEY`     | Secret          | Webhook signature verification     |
| `DISCORD_APPLICATION_ID` | Secret          | Discord app ID                     |
| `OPENROUTER_API_KEY`     | Secret          | OpenRouter API auth                |
| `INTERNAL_API`           | Service Binding | Lapidary Knowledge Graph API (VPC) |
| `INTERNAL_API_URL`       | Variable        | Base URL for Lapidary API requests |
| `LANGFUSE_PUBLIC_KEY`    | Secret          | Langfuse API auth (public key)     |
| `LANGFUSE_SECRET_KEY`    | Secret          | Langfuse API auth (secret key)     |
| `LANGFUSE_BASE_URL`      | Variable        | Langfuse API base URL              |
| `ENVIRONMENT`            | Variable        | Environment name for telemetry     |
| `ASK_WORKFLOW`           | Workflow        | Cloudflare Workflow binding        |
