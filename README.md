# Lapidary Ask Bot

A Discord bot deployed on Cloudflare Workers that lets Ruby community members query the Lapidary Knowledge Graph via a `/ask` slash command. It uses an LLM (via OpenRouter) with tool calling to search nodes and relationships between Rubyists and Ruby core modules/standard libraries.

## Features

- `/ask` slash command accepting natural language questions
- LLM-powered assistant that interprets questions and queries the Lapidary Knowledge Graph
- Guardrails check to filter irrelevant questions before invoking the main LLM
- Read-only access to the (Rubyist, Relationship, Module) knowledge graph
- Responds in the same language as the user's question
- LLM observability via Langfuse (traces, generations, tool calls)

## Tech Stack

| Component | Technology                               |
| --------- | ---------------------------------------- |
| Runtime   | Cloudflare Workers                       |
| Framework | Hono                                     |
| Language  | TypeScript                               |
| AI        | Vercel AI SDK + OpenRouter               |
| Telemetry | Langfuse                                 |
| Testing   | Vitest + @cloudflare/vitest-pool-workers |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/)
- [pnpm](https://pnpm.io/)
- A Discord application with bot credentials
- An [OpenRouter](https://openrouter.ai/) API key

### Setup

1. Install dependencies:

   ```sh
   pnpm install
   ```

2. Create a `.dev.vars` file with the required secrets:

   | Variable                 | Required | Description                        |
   | ------------------------ | -------- | ---------------------------------- |
   | `DISCORD_BOT_TOKEN`      | Yes      | Discord bot authentication         |
   | `DISCORD_PUBLIC_KEY`     | Yes      | Webhook signature verification     |
   | `DISCORD_APPLICATION_ID` | Yes      | Discord application identifier     |
   | `OPENROUTER_API_KEY`     | Yes      | OpenRouter API authentication      |
   | `INTERNAL_API_URL`       | Yes      | Base URL for Lapidary API requests |
   | `LANGFUSE_PUBLIC_KEY`    | No       | Langfuse API public key            |
   | `LANGFUSE_SECRET_KEY`    | No       | Langfuse API secret key            |
   | `LANGFUSE_BASE_URL`      | No       | Langfuse API base URL              |

   Langfuse credentials are optional — telemetry is disabled when not configured.

3. Register the Discord slash commands:

   ```sh
   pnpm register
   ```

4. Start the development server:

   ```sh
   pnpm dev
   ```

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

## Architecture

The project follows a layered architecture under `src/`:

```
Discord Webhook
      │
      ▼
  index.tsx ──► discord.ts (verify signature, defer, route)
                    │
                    ▼
             workflows/ask.ts (AskWorkflow)
              ┌─────┴─────┐
              ▼           ▼
        guardrails.ts   client.ts (askLLM)
        (relevance       │
         check)          ├── tools.ts ──► Lapidary API
                         │                (via VPC Binding)
                         └── telemetry/
                              └──► Langfuse
              │
              ▼
         discord/api.ts (patch response back)
```

### Request Flow

1. Discord sends webhook → Hono route → `handleDiscordWebhook()`
2. Verifies Ed25519 signature, defers response (ACK), spawns `AskWorkflow`
3. `AskWorkflow.run()` runs guardrails check; if rejected, replies with rejection reason
4. If relevant, calls `askLLM()` with tools (max 15 steps)
5. Tools query Lapidary Knowledge Graph via VPC service binding
6. Response patched back via Discord interaction webhook

## License

[MIT](LICENSE)
