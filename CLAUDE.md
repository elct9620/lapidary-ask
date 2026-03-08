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
- **Workflow**: `src/workflows/ask.ts` — `AskWorkflow` (Cloudflare Workflow) orchestrates LLM call and Discord response with retries
- **Agent (LLM)**: `src/agent/` — LLM integration layer
  - `client.ts` — `askLLM()` using Vercel AI SDK with OpenRouter (`openrouter/free`)
  - `tools.ts` — AI SDK tool definitions (`searchNodes`, `getNeighbors`) for querying Lapidary Knowledge Graph via `INTERNAL_API` service binding
  - `prompt.ts` — Locale-aware system prompt builder (maps Discord locale to response language)
- **Formatting**: `src/format.ts` — Wraps GFM tables in code blocks for Discord, truncates to 2000 chars
- **Command definitions**: `src/commands.ts` — Discord slash command registration metadata (with zh-TW and ja localizations)
- **Registration script**: `scripts/register.ts` — Registers/clears slash commands via Discord API

### Request Flow

1. Discord sends webhook → Hono route → `handleDiscordWebhook()`
2. Verifies Ed25519 signature, defers response (ACK), spawns `AskWorkflow`
3. `AskWorkflow.run()` calls `askLLM()` with tools (max 15 steps)
4. Tools query Lapidary Knowledge Graph via VPC service binding
5. Response patched back via Discord interaction webhook

### Cloudflare Workflows

`step.do()` calls must be placed directly inside the `run()` method for proper step visibility and tracing — do not wrap them in helper functions.

## Testing

Tests use Vitest with `@cloudflare/vitest-pool-workers` to run in a Workers-like environment. Coverage uses Istanbul provider. Test files go in `tests/` directory. Config references `wrangler.jsonc` for worker pool options.

The `vitest.config.ts` configures SSR optimization for `discord-api-types` and `discord-interactions` packages to work in the Workers environment.

## Key Bindings

| Binding                  | Type            | Purpose                            |
| ------------------------ | --------------- | ---------------------------------- |
| `DISCORD_BOT_TOKEN`      | Secret          | Discord bot auth                   |
| `DISCORD_PUBLIC_KEY`     | Secret          | Webhook signature verification     |
| `DISCORD_APPLICATION_ID` | Secret          | Discord app ID                     |
| `OPENROUTER_API_KEY`     | Secret          | OpenRouter API auth                |
| `INTERNAL_API`           | Service Binding | Lapidary Knowledge Graph API (VPC) |
| `INTERNAL_API_URL`       | Variable        | Base URL for Lapidary API requests |
| `ASK_WORKFLOW`           | Workflow        | Cloudflare Workflow binding        |
