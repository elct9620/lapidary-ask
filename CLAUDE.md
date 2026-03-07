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
- **Bot setup**: `src/bot.ts` — Creates `Chat` instance, wires Discord adapter and registers command handlers
- **Handlers**: `src/handlers/` — Command handlers (e.g., `ask.ts` registers the `/ask` slash command handler)
- **Agent (LLM)**: `src/agent/` — LLM integration layer
  - `client.ts` — `askLLM()` function using Vercel AI SDK with OpenRouter (`openrouter/auto`)
  - `tools.ts` — AI SDK tool definitions for querying Lapidary Knowledge Graph (to be implemented per SPEC.md)
  - `prompt.ts` — System prompt in Traditional Chinese
- **Discord adapter**: `src/adapter/discord/` — Custom Discord adapter implementing the `chat` package's `Adapter` interface
  - `adapter.ts` — Webhook verification, interaction handling, deferred responses via `AsyncLocalStorage`
  - `helpers.ts` — Extracts typed options from slash command interactions
  - `format.ts` — Discord message formatting
- **Command definitions**: `src/commands.ts` — Discord slash command registration metadata
- **Registration script**: `scripts/register.ts` — Registers/clears slash commands via Discord API

### Request Flow

1. Discord sends webhook → Hono route → `bot.webhooks.discord()`
2. `DiscordAdapter` verifies signature, defers response, dispatches to `Chat`
3. `Chat` triggers the registered `/ask` handler in `src/handlers/ask.ts`
4. Handler calls `askLLM()` which invokes OpenRouter with tools
5. Response posted back via Discord interaction webhook (PATCH for initial, POST for follow-ups)

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
