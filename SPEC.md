# Lapidary Ask Bot

## Intent

Lapidary Ask Bot is a Discord Bot that enables Ruby community members to query the Lapidary Knowledge Graph through natural language conversation. It lowers the barrier to discovering which Rubyists maintain or contribute to Ruby core modules and standard libraries, and how these relationships evolve over time.

## Users

| Role             | Description                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Community Member | A Ruby community Discord user who asks questions about Rubyists and their relationships to core modules and standard libraries |

## Scope

### IS

- A Discord slash command (`/ask`) that accepts natural language questions
- An LLM-powered assistant that interprets questions and queries the Lapidary Knowledge Graph
- A read-only interface to Lapidary's (Rubyist, Relationship, Module) knowledge graph

### IS NOT

- A general-purpose chatbot (questions unrelated to Ruby core development receive a polite decline)
- A write interface to the Knowledge Graph (no mutations)
- A multi-turn conversation system (each `/ask` is stateless)
- A direct database query tool (users never write queries)
- A source of information about arbitrary Ruby gems or third-party libraries (only Ruby core modules and standard libraries are tracked)

## User Journeys

| Context                                                | Action                                                               | Outcome                                                                                        |
| ------------------------------------------------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| A member wants to know who maintains a core module     | Types `/ask question: Who maintains the String module?`              | Bot replies with Rubyists who have a Maintenance relationship to the String CoreModule         |
| A member asks what modules a Rubyist contributes to    | Types `/ask question: What modules does matz contribute to?`         | Bot replies with a list of CoreModules and Stdlibs the Rubyist is connected to                 |
| A member asks about a standard library                 | Types `/ask question: Who contributes to the json standard library?` | Bot replies with Rubyists connected to the json Stdlib node                                    |
| A member asks about an arbitrary gem outside Ruby core | Types `/ask question: Who maintains the Rails gem?`                  | Bot replies that it only tracks Ruby core modules and standard libraries, not third-party gems |
| A member asks an unrelated question                    | Types `/ask question: What is the weather today?`                    | Bot replies that it only answers Ruby core development questions                               |
| The Knowledge Graph has no matching data               | Types `/ask question: Who maintains the Ractor module?`              | Bot replies that no relationship data was found for this module                                |

## Behavior

### `/ask` Command

| Property            | Value                                                                    |
| ------------------- | ------------------------------------------------------------------------ |
| Command name        | `ask`                                                                    |
| Option              | `question` (string, required)                                            |
| Response visibility | Visible to the entire channel                                            |
| Response format     | Markdown                                                                 |
| Maximum LLM steps   | 15                                                                       |
| Max response length | 2000 characters (Discord limit); truncated with `...` suffix if exceeded |

The bot acknowledges the interaction immediately via Discord's deferred response mechanism, then delegates processing to a Cloudflare Workflow. The Workflow invokes the LLM, formats the result, and patches the Discord response asynchronously.

### LLM Processing

The system uses OpenRouter to access free-tier LLM models via the Vercel AI SDK (`ai` package).

| Property               | Value                                     |
| ---------------------- | ----------------------------------------- |
| Provider               | OpenRouter                                |
| Model                  | `openrouter/free`                         |
| System prompt language | Traditional Chinese (Taiwan)              |
| Tool calling           | Enabled, up to 15 steps                   |
| Response language      | Matches user question language by default |

The LLM receives the user's question and a set of tools for querying the Lapidary Knowledge Graph. It decides autonomously which tools to invoke (if any) and synthesizes results into a human-readable answer.

### Lapidary Knowledge Graph Integration

The bot accesses the Lapidary API through a Cloudflare VPC Binding (`env.INTERNAL_API`). All API calls use `env.INTERNAL_API.fetch()` with URLs constructed from the `INTERNAL_API_URL` base URL (e.g., `${INTERNAL_API_URL}/graph/nodes`).

#### Data Model

The Knowledge Graph contains three node types and two relationship types:

| Node Type    | Description                                        | ID Format            |
| ------------ | -------------------------------------------------- | -------------------- |
| `Rubyist`    | A person who participates in Ruby core development | `Rubyist://username` |
| `CoreModule` | A built-in Ruby module (e.g., String, Array, IO)   | `CoreModule://name`  |
| `Stdlib`     | A standard library shipped with Ruby (e.g., json)  | `Stdlib://name`      |

| Relationship  | Meaning                                              | Direction        |
| ------------- | ---------------------------------------------------- | ---------------- |
| `Maintenance` | Rubyist has maintenance responsibility for a module  | Rubyist → Module |
| `Contribute`  | Rubyist has submitted code contributions to a module | Rubyist → Module |

#### Tools

| Tool           | Purpose                                                                             | Parameters                                                                      | Maps to Lapidary API   |
| -------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------- |
| `searchNodes`  | Search nodes by type and keyword                                                    | `type?: "Rubyist" \| "CoreModule" \| "Stdlib"`, `query?: string`                | `GET /graph/nodes`     |
| `getNeighbors` | Get all nodes connected to a given node in both directions with their relationships | `nodeId: string` (e.g., `Rubyist://matz`); always queries with `direction=both` | `GET /graph/neighbors` |

Each tool returns structured data that the LLM formats into a Markdown response.

#### Tool Error Behavior

| Lapidary Response           | Tool Returns to LLM                                             |
| --------------------------- | --------------------------------------------------------------- |
| `200 OK`                    | Parsed JSON data (nodes, neighbors, edges)                      |
| `400 Bad Request`           | Error message indicating invalid parameters                     |
| `404 Not Found`             | Error message indicating the requested node does not exist      |
| `500 Internal Server Error` | Error message indicating the service is temporarily unavailable |
| Network / binding failure   | Error message indicating the service is unreachable             |

The LLM interprets tool errors and responds to the user in natural language. Tools never surface raw error responses to users.

### Error Handling

| Scenario                                 | Behavior                                                                            |
| ---------------------------------------- | ----------------------------------------------------------------------------------- |
| Missing `question` option                | Reply: "Please provide a question."                                                 |
| OpenRouter API failure                   | Workflow retries the LLM step once; if still failing, reply with a generic error    |
| INTERNAL_API / Lapidary API failure      | LLM receives an error from the tool and explains that data is currently unavailable |
| LLM returns empty response               | Reply: "No response."                                                               |
| Discord response post failure            | Workflow retries the response step up to 2 times before giving up                   |
| Workflow failure (all retries exhausted) | Reply: "LLM processing failed. Please try again later."                             |
| Discord interaction timeout (>15 min)    | Response is silently dropped by Discord; no retry                                   |

## System Boundaries

| Boundary           | Protocol                                            | Auth                           |
| ------------------ | --------------------------------------------------- | ------------------------------ |
| Discord → Bot      | HTTPS webhook, signature verification               | Discord public key             |
| Bot → OpenRouter   | HTTPS REST API                                      | API key (`OPENROUTER_API_KEY`) |
| Bot → Lapidary API | Cloudflare VPC Binding (`env.INTERNAL_API.fetch()`) | None (network-level isolation) |

### Environment Bindings

| Binding                  | Type            | Purpose                                      |
| ------------------------ | --------------- | -------------------------------------------- |
| `DISCORD_BOT_TOKEN`      | Secret          | Discord bot authentication                   |
| `DISCORD_PUBLIC_KEY`     | Secret          | Webhook signature verification               |
| `DISCORD_APPLICATION_ID` | Secret          | Discord application identifier               |
| `OPENROUTER_API_KEY`     | Secret          | OpenRouter API authentication                |
| `INTERNAL_API`           | Service Binding | Lapidary Knowledge Graph API access          |
| `INTERNAL_API_URL`       | Variable        | Base URL for Lapidary API requests           |
| `ASK_WORKFLOW`           | Workflow        | Cloudflare Workflow for async LLM processing |

## Terminology

| Term            | Definition                                                                                                           |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| Lapidary        | A knowledge graph builder that maps relationships between Ruby contributors and core modules from bugs.ruby-lang.org |
| Knowledge Graph | The structured data store of (Rubyist, Relationship, Module) triplets extracted from Ruby issue tracker discussions  |
| Rubyist         | A person who participates in Ruby core development, identified by their bugs.ruby-lang.org username                  |
| CoreModule      | A built-in Ruby module (e.g., String, Array, IO) that is always available without `require`                          |
| Stdlib          | A standard library shipped with Ruby that requires explicit `require` (e.g., json, net/http)                         |
| Node ID         | Identifier in `type://name` format (e.g., `Rubyist://matz`, `CoreModule://String`)                                   |
| VPC Binding     | Cloudflare's mechanism for private service-to-service communication                                                  |
| OpenRouter      | An LLM gateway that provides access to multiple AI models through a unified API                                      |
| Tool Calling    | The AI SDK pattern where the LLM invokes predefined functions to retrieve external data                              |

## Runtime

| Property      | Value                        |
| ------------- | ---------------------------- |
| Platform      | Cloudflare Workers           |
| Async runtime | Cloudflare Workflows         |
| Framework     | Hono                         |
| Language      | TypeScript                   |
| AI SDK        | Vercel AI SDK (`ai` package) |
