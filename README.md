# Lapidary Ask Bot

A Discord bot that enables Ruby community members to query the [Lapidary Knowledge Graph](https://github.com/purduesigbots/lapidary) through natural language conversation. Use the `/ask` slash command to discover which Rubyists maintain or contribute to Ruby core modules and standard libraries.

## Features

- `/ask` slash command accepting natural language questions
- LLM-powered assistant that interprets questions and queries the Lapidary Knowledge Graph
- Read-only access to the (Rubyist, Relationship, Module) knowledge graph
- Responds in the same language as the user's question

## Tech Stack

| Component | Technology                               |
| --------- | ---------------------------------------- |
| Runtime   | Cloudflare Workers                       |
| Framework | Hono                                     |
| Language  | TypeScript                               |
| AI        | Vercel AI SDK + OpenRouter               |
| Testing   | Vitest + @cloudflare/vitest-pool-workers |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/)
- [pnpm](https://pnpm.io/)
- A Discord application with bot credentials
- An [OpenRouter](https://openrouter.ai/) API key

### Setup

1. Clone the repository and install dependencies:

   ```sh
   git clone https://github.com/purduesigbots/ruby-lapidary-ask.git
   cd ruby-lapidary-ask
   pnpm install
   ```

2. Create a `.dev.vars` file with the required secrets:

   ```
   DISCORD_BOT_TOKEN=your_bot_token
   DISCORD_PUBLIC_KEY=your_public_key
   DISCORD_APPLICATION_ID=your_application_id
   OPENROUTER_API_KEY=your_openrouter_key
   INTERNAL_API_URL=your_lapidary_api_url
   ```

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

The project follows a layered architecture:

```
src/
  index.tsx        # Hono app entry point
  bot.ts           # Chat instance setup
  commands.ts      # Discord slash command definitions
  handlers/        # Command handlers (e.g., /ask)
  agent/           # LLM integration (client, tools, prompt)
  adapter/discord/ # Discord webhook adapter
scripts/
  register.ts      # Slash command registration script
```

### Request Flow

1. Discord sends a webhook to the Hono route
2. `DiscordAdapter` verifies the signature, defers the response, and dispatches to `Chat`
3. The registered `/ask` handler calls the LLM via OpenRouter
4. The LLM uses tools (`searchNodes`, `getNeighbors`) to query the Lapidary Knowledge Graph
5. The response is posted back via Discord's interaction webhook

## License

[MIT](LICENSE)
