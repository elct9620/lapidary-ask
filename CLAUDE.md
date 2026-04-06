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
  - `provider-fallback.ts` — `withGoogleFallback()` generic dual-provider fallback (Google AI Studio primary, OpenRouter fallback)
  - `index.ts` — Re-exports `askLLM` and `checkGuardrails`
- **Telemetry**: `src/telemetry/` — Langfuse client for feedback scores (see below)
- **Formatting**: `src/format.ts` — Wraps GFM tables in code blocks for Discord, truncates to 2000 chars
- **Command definitions**: `src/commands.ts` — Discord slash command registration metadata (with zh-TW and ja localizations)
- **Container**: `src/container.ts` — Dependency injection factory (`createContainer()`) that wires providers, tools, telemetry, and Discord helpers from `env`
- **Models**: `src/models.ts` — Default model name constants for AI Studio and OpenRouter
- **Locale**: `src/locale.ts` — Discord locale to language name mapping
- **Discord feedback**: `src/discord/feedback.ts` — Button click handler for 👍/👎 feedback scoring
- **Discord components**: `src/discord/components.ts` — Feedback button component builders
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

Telemetry uses `@aotoki/edge-otel` with a Langfuse exporter, configured via `createTracerProvider()` in `src/container.ts`. The AI SDK's `experimental_telemetry` option receives an OpenTelemetry `Tracer` instance directly — no custom integration layer.

- `src/telemetry/client.ts` — `LangfuseClient` used only for feedback score ingestion (`createScore()`), not for LLM tracing
- `src/container.ts` — `createTracerProvider()` sets up the `@aotoki/edge-otel` tracer with Langfuse exporter; returns `null` when credentials are missing

Telemetry is opt-in: when `LANGFUSE_PUBLIC_KEY` or `LANGFUSE_SECRET_KEY` is not configured, tracing is disabled silently.

## Testing

Tests use Vitest with `@cloudflare/vitest-pool-workers` to run in a Workers-like environment. Coverage uses Istanbul provider. Test files go in `tests/` directory. Config references `wrangler.jsonc` for worker pool options.

The `vitest.config.ts` configures SSR optimization for `discord-api-types` and `discord-interactions` packages to work in the Workers environment.

Workflow tests use `introspectWorkflowInstance` with `mockStepResult`/`mockStepError` to test step orchestration without executing actual callbacks.

## Key Bindings

| Binding                  | Type            | Purpose                                 |
| ------------------------ | --------------- | --------------------------------------- |
| `DISCORD_BOT_TOKEN`      | Secret          | Discord bot auth                        |
| `DISCORD_PUBLIC_KEY`     | Secret          | Webhook signature verification          |
| `DISCORD_APPLICATION_ID` | Secret          | Discord app ID                          |
| `AI_STUDIO_API_KEY`      | Secret          | Google AI Studio API auth (primary)     |
| `AI_STUDIO_GUARD_MODEL`  | Variable        | Model for Guardrails via AI Studio      |
| `AI_STUDIO_ASK_MODEL`    | Variable        | Model for LLM Processing via AI Studio  |
| `OPENROUTER_API_KEY`     | Secret          | OpenRouter API auth (fallback)          |
| `OPENROUTER_GUARD_MODEL` | Variable        | Model for Guardrails via OpenRouter     |
| `OPENROUTER_ASK_MODEL`   | Variable        | Model for LLM Processing via OpenRouter |
| `INTERNAL_API`           | Service Binding | Lapidary Knowledge Graph API (VPC)      |
| `INTERNAL_API_URL`       | Variable        | Base URL for Lapidary API requests      |
| `LANGFUSE_PUBLIC_KEY`    | Secret          | Langfuse API auth (public key)          |
| `LANGFUSE_SECRET_KEY`    | Secret          | Langfuse API auth (secret key)          |
| `LANGFUSE_BASE_URL`      | Variable        | Langfuse API base URL                   |
| `ENVIRONMENT`            | Variable        | Environment name for telemetry          |
| `ASK_WORKFLOW`           | Workflow        | Cloudflare Workflow binding             |
