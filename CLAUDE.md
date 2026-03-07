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

- **Runtime**: Cloudflare Workers with Hono framework
- **Entry point**: `src/index.tsx` — Hono app with Discord webhook endpoint at `POST /api/webhooks/discord`
- **Bot framework**: `chat` package with `@chat-adapter/discord` adapter handles Discord interaction verification and deferred responses
- **LLM**: `src/llm.ts` — Uses Vercel AI SDK (`ai`) with OpenRouter provider, model `openrouter/auto`, system prompt in Traditional Chinese
- **Tools**: `src/tools.ts` — AI SDK tool definitions for querying Lapidary Knowledge Graph (currently empty, to be implemented per SPEC.md)
- **Discord helpers**: `src/discord-helpers.ts` — Extracts typed options from Discord slash command interactions
- **Command definitions**: `src/commands.ts` — Discord slash command registration metadata
- **Registration script**: `scripts/register.ts` — Registers/clears slash commands via Discord API

## Testing

Tests use Vitest with `@cloudflare/vitest-pool-workers` to run in a Workers-like environment. Coverage uses Istanbul provider. Test files go in `tests/` directory. Config references `wrangler.jsonc` for worker pool options.

## Key Bindings

| Binding                  | Type            | Purpose                            |
| ------------------------ | --------------- | ---------------------------------- |
| `DISCORD_BOT_TOKEN`      | Secret          | Discord bot auth                   |
| `DISCORD_PUBLIC_KEY`     | Secret          | Webhook signature verification     |
| `DISCORD_APPLICATION_ID` | Secret          | Discord app ID                     |
| `OPENROUTER_API_KEY`     | Secret          | OpenRouter API auth                |
| `INTERNAL_API`           | Service Binding | Lapidary Knowledge Graph API (VPC) |
