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
- LLM call observability via Langfuse, tracking token usage, tool calls, and latency
- User feedback mechanism (the questioner can rate answer quality with 👍/👎 buttons)

### IS NOT

- A general-purpose chatbot (questions unrelated to Ruby core development receive a polite decline)
- A write interface to the Knowledge Graph (no mutations)
- A multi-turn conversation system (each `/ask` is stateless)
- A direct database query tool (users never write queries)
- A source of information about arbitrary Ruby gems or third-party libraries (only Ruby core modules and standard libraries are tracked)
- A real-time monitoring or alerting system (telemetry is for post-hoc analysis)
- A multi-user voting system (only the original questioner can rate an answer)

## User Journeys

| Context                                                | Action                                                               | Outcome                                                                                          |
| ------------------------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| A member wants to know who maintains a core module     | Types `/ask question: Who maintains the String module?`              | Bot replies with Rubyists who have a Maintenance relationship to the String CoreModule           |
| A member asks what modules a Rubyist contributes to    | Types `/ask question: What modules does matz contribute to?`         | Bot replies with a list of CoreModules and Stdlibs the Rubyist is connected to                   |
| A member asks about a standard library                 | Types `/ask question: Who contributes to the json standard library?` | Bot replies with Rubyists connected to the json Stdlib node                                      |
| A member asks about an arbitrary gem outside Ruby core | Types `/ask question: Who maintains the Rails gem?`                  | Bot replies that it only tracks Ruby core modules and standard libraries, not third-party gems   |
| A member asks an unrelated question                    | Types `/ask question: What is the weather today?`                    | Bot replies that it only answers Ruby core development questions                                 |
| The Knowledge Graph has no matching data               | Types `/ask question: Who maintains the Ractor module?`              | Bot replies that no relationship data was found for this module                                  |
| The questioner wants to rate an answer                 | Clicks 👍 or 👎 button below the bot's response                      | Button is removed, score is recorded to Langfuse                                                 |
| A non-questioner tries to rate an answer               | Clicks 👍 or 👎 button on someone else's question                    | Sees an ephemeral message saying only the questioner can rate; buttons remain for the questioner |

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

#### Request Flow

1. Discord webhook → Hono → `handleDiscordWebhook()`
2. Verify signature, defer response, start `AskWorkflow`
3. `AskWorkflow.run()` calls Guardrails to check input relevance
4. If irrelevant → reply with Guardrails rejection reason, end workflow
5. If relevant → call `askLLM()` with tools (max 15 steps); TelemetryIntegration collects events during execution
6. Format response and patch back to Discord with feedback buttons attached (telemetry batch sent to Langfuse within the LLM step)

### LLM Provider Strategy

Both Guardrails and LLM Processing use a dual-provider strategy with automatic fallback.

| Property          | Value                                                                          |
| ----------------- | ------------------------------------------------------------------------------ |
| Primary provider  | Google AI Studio                                                               |
| Fallback provider | OpenRouter                                                                     |
| Applies to        | Guardrails and LLM Processing                                                  |
| Fallback trigger  | API error (4xx/5xx), network failure, or request timeout from primary provider |
| Fallback behavior | Retry the same call once using the fallback provider                           |

Fallback occurs **within** a single Workflow step. If both providers fail, the step itself fails and Workflow retry (if configured) restarts from the primary provider.

When `AI_STUDIO_API_KEY` is not configured, the system uses OpenRouter as the sole provider with no fallback (equivalent to pre-migration behavior).

Model selection is configured per provider and per function via environment variables:

| Binding                  | Purpose                                            |
| ------------------------ | -------------------------------------------------- |
| `AI_STUDIO_GUARD_MODEL`  | Model for Guardrails via AI Studio                 |
| `AI_STUDIO_ASK_MODEL`    | Model for LLM Processing via AI Studio             |
| `OPENROUTER_GUARD_MODEL` | Model for Guardrails via OpenRouter (fallback)     |
| `OPENROUTER_ASK_MODEL`   | Model for LLM Processing via OpenRouter (fallback) |

### Guardrails

Before invoking the main LLM, the Workflow runs a lightweight Guardrails check to determine whether the user's question is related to querying the Lapidary Knowledge Graph (Ruby core development, Rubyists, core modules, standard libraries).

| Property | Value                                                                   |
| -------- | ----------------------------------------------------------------------- |
| Provider | Primary provider (AI Studio), with fallback to OpenRouter               |
| Model    | Configured via `AI_STUDIO_GUARD_MODEL` / `OPENROUTER_GUARD_MODEL`       |
| Purpose  | Determine whether the input is relevant to the Lapidary Knowledge Graph |
| Output   | Pass (relevant) or Reject (irrelevant, with reason)                     |

#### Rules

- **Pass** → continue to `askLLM()` processing
- **Reject** → use the rejection reason from the Guardrails LLM as the response to the user, skip `askLLM()`
- **Provider failure** → fallback within step (primary → fallback); if both fail → fail-open (treat as pass), continue to `askLLM()`

### Feedback

After the bot responds with an LLM-generated answer, the message includes feedback buttons so the questioner can rate the answer quality. Feedback buttons are not attached to Guardrails rejection messages.

#### Message Components

| Property     | Value                                                            |
| ------------ | ---------------------------------------------------------------- |
| Layout       | One ActionRow containing two Buttons                             |
| Button style | Secondary                                                        |
| Buttons      | 👍 "Helpful" / 👎 "Not helpful"                                  |
| `custom_id`  | `feedback:{traceId}:{userId}:{up\|down}` (max 100 chars)         |
| Attached to  | The response message patched back to Discord in the Request Flow |

The `traceId` links feedback to the Langfuse trace. The `userId` is the original questioner's Discord user ID, encoded so identity can be verified without external storage.

#### Button Click Handling

Feedback button clicks arrive as `MessageComponent` interactions on the same webhook endpoint. They are handled synchronously within the webhook handler (no Workflow needed):

1. Parse `custom_id` to extract `traceId`, `userId`, and direction (`up`/`down`)
2. Compare `userId` from `custom_id` with the clicking user's ID from the interaction
3. **Match** → send a score to Langfuse, respond with `UpdateMessage` removing all components (buttons disappear)
4. **Mismatch** → respond with an ephemeral message indicating only the questioner can rate; buttons remain unchanged

#### Langfuse Score

| Property   | Value                                    |
| ---------- | ---------------------------------------- |
| Event type | `score-create` (via batch ingestion API) |
| `traceId`  | Extracted from `custom_id`               |
| `name`     | `user-feedback`                          |
| `value`    | `1` (👍) or `0` (👎)                     |
| `dataType` | `NUMERIC`                                |

No additional storage (KV, D1) is required. The `custom_id` encodes all state needed for verification and scoring.

### LLM Processing

The system uses the Vercel AI SDK (`ai` package) to call LLM models, with Google AI Studio as the primary provider and OpenRouter as fallback.

| Property               | Value                                                   |
| ---------------------- | ------------------------------------------------------- |
| Primary provider       | Google AI Studio (configured via `AI_STUDIO_ASK_MODEL`) |
| Fallback provider      | OpenRouter (configured via `OPENROUTER_ASK_MODEL`)      |
| System prompt language | English                                                 |
| Tool calling           | Enabled, up to 15 steps                                 |
| Response language      | Matches the user's question language                    |

The LLM receives the user's question and a set of tools for querying the Lapidary Knowledge Graph. It decides autonomously which tools to invoke (if any) and synthesizes results into a human-readable answer.

### Observability

The system uses AI SDK `TelemetryIntegration` lifecycle hooks to collect LLM telemetry events, then sends them to Langfuse via its REST API batch ingestion endpoint (`POST /api/public/ingestion`).

#### Data Collection

| Langfuse Entity | Granularity               | Data Captured                                      |
| --------------- | ------------------------- | -------------------------------------------------- |
| Trace           | One per `/ask` invocation | Question input, final response, locale, duration   |
| Generation      | One per LLM call (step)   | Model, prompt/completion tokens, latency           |
| Span            | One per tool call         | Tool name, arguments, result, duration             |
| Score           | One per feedback click    | User feedback value (1 = helpful, 0 = not helpful) |

#### Lifecycle Mapping

| AI SDK Event       | Langfuse Event      |
| ------------------ | ------------------- |
| `onStart`          | `trace-create`      |
| `onStepStart`      | `generation-create` |
| `onToolCallStart`  | `span-create`       |
| `onToolCallFinish` | `span-update`       |
| `onStepFinish`     | `generation-update` |
| `onFinish`         | Batch POST to API   |

#### Design Constraints

- Telemetry failure does not affect the main response flow (fire-and-forget)
- Telemetry is disabled when Langfuse credentials are not configured (no error raised)
- Telemetry batch is sent within the Workflow step that calls `askLLM()`, before the step returns
- Inputs and outputs are recorded by default; controllable via `recordInputs` / `recordOutputs` settings

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

| Scenario                                 | Behavior                                                                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Missing `question` option                | Reply: "Please provide a question."                                                                                                        |
| Guardrails rejects input                 | Reply with the rejection reason generated by the Guardrails LLM                                                                            |
| Guardrails provider failure              | Fallback within step (primary → fallback); if both fail → fail-open (treat as pass)                                                        |
| LLM step provider failure                | Fallback within step (primary → fallback); if both fail → step fails, Workflow retries once from primary; if still failing → generic error |
| INTERNAL_API / Lapidary API failure      | LLM receives an error from the tool and explains that data is currently unavailable                                                        |
| LLM returns empty response               | Reply: "No response."                                                                                                                      |
| Discord response post failure            | Workflow retries the response step up to 2 times before giving up                                                                          |
| Workflow failure (all retries exhausted) | Reply: "LLM processing failed. Please try again later."                                                                                    |
| Langfuse API failure                     | Silently ignored; does not affect user response                                                                                            |
| Discord interaction timeout (>15 min)    | Response is silently dropped by Discord; no retry                                                                                          |
| Feedback score submission fails          | Buttons are still removed; Langfuse failure does not affect user experience                                                                |
| Feedback `custom_id` cannot be parsed    | Respond with ephemeral error message; buttons remain unchanged                                                                             |

## System Boundaries

| Boundary               | Protocol                                            | Auth                                 |
| ---------------------- | --------------------------------------------------- | ------------------------------------ |
| Discord → Bot          | HTTPS webhook, signature verification               | Discord public key                   |
| Bot → Google AI Studio | HTTPS REST API                                      | API key (`AI_STUDIO_API_KEY`)        |
| Bot → OpenRouter       | HTTPS REST API                                      | API key (`OPENROUTER_API_KEY`)       |
| Bot → Lapidary API     | Cloudflare VPC Binding (`env.INTERNAL_API.fetch()`) | None (network-level isolation)       |
| Bot → Langfuse         | HTTPS REST API                                      | Basic Auth (public key + secret key) |

### Environment Bindings

| Binding                  | Type            | Purpose                                                                                         |
| ------------------------ | --------------- | ----------------------------------------------------------------------------------------------- |
| `DISCORD_BOT_TOKEN`      | Secret          | Discord bot authentication                                                                      |
| `DISCORD_PUBLIC_KEY`     | Secret          | Webhook signature verification                                                                  |
| `DISCORD_APPLICATION_ID` | Secret          | Discord application identifier                                                                  |
| `AI_STUDIO_API_KEY`      | Secret          | Google AI Studio API authentication                                                             |
| `AI_STUDIO_GUARD_MODEL`  | Variable        | Model name for Guardrails via AI Studio                                                         |
| `AI_STUDIO_ASK_MODEL`    | Variable        | Model name for LLM Processing via AI Studio                                                     |
| `OPENROUTER_API_KEY`     | Secret          | OpenRouter API authentication (fallback)                                                        |
| `OPENROUTER_GUARD_MODEL` | Variable        | Model name for Guardrails via OpenRouter (fallback)                                             |
| `OPENROUTER_ASK_MODEL`   | Variable        | Model name for LLM Processing via OpenRouter (fallback)                                         |
| `INTERNAL_API`           | Service Binding | Lapidary Knowledge Graph API access                                                             |
| `INTERNAL_API_URL`       | Secret          | Base URL for Lapidary API requests (configured via Cloudflare dashboard, not in wrangler.jsonc) |
| `LANGFUSE_PUBLIC_KEY`    | Secret          | Langfuse API authentication (public key)                                                        |
| `LANGFUSE_SECRET_KEY`    | Secret          | Langfuse API authentication (secret key)                                                        |
| `LANGFUSE_BASE_URL`      | Variable        | Langfuse API base URL (default: `https://cloud.langfuse.com`)                                   |
| `ASK_WORKFLOW`           | Workflow        | Cloudflare Workflow for async LLM processing                                                    |

## Terminology

| Term                 | Definition                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Lapidary             | A knowledge graph builder that maps relationships between Ruby contributors and core modules from bugs.ruby-lang.org |
| Knowledge Graph      | The structured data store of (Rubyist, Relationship, Module) triplets extracted from Ruby issue tracker discussions  |
| Rubyist              | A person who participates in Ruby core development, identified by their bugs.ruby-lang.org username                  |
| CoreModule           | A built-in Ruby module (e.g., String, Array, IO) that is always available without `require`                          |
| Stdlib               | A standard library shipped with Ruby that requires explicit `require` (e.g., json, net/http)                         |
| Node ID              | Identifier in `type://name` format (e.g., `Rubyist://matz`, `CoreModule://String`)                                   |
| VPC Binding          | Cloudflare's mechanism for private service-to-service communication                                                  |
| Google AI Studio     | Google's platform for accessing Gemini models via API, used as the primary LLM provider                              |
| OpenRouter           | An LLM gateway that provides access to multiple AI models through a unified API; used as the fallback provider       |
| Provider Fallback    | Automatic retry of an LLM call using the fallback provider when the primary provider returns an API error            |
| Tool Calling         | The AI SDK pattern where the LLM invokes predefined functions to retrieve external data                              |
| Langfuse             | An open-source LLM observability platform for tracing, evaluating, and debugging AI applications                     |
| TelemetryIntegration | AI SDK v6 lifecycle hook interface for collecting telemetry events without OTel dependencies                         |
| Trace                | A Langfuse entity representing one end-to-end `/ask` invocation                                                      |
| Generation           | A Langfuse entity representing a single LLM call within a trace, including token usage and latency                   |
| Score                | A Langfuse entity representing a numeric evaluation attached to a trace (e.g., user feedback)                        |
| Feedback             | A user-initiated quality rating (👍/👎) on a bot response, recorded as a Langfuse Score                              |
| Message Component    | A Discord interactive element (e.g., Button) attached to a message, identified by a `custom_id`                      |

## Runtime

| Property      | Value                        |
| ------------- | ---------------------------- |
| Platform      | Cloudflare Workers           |
| Async runtime | Cloudflare Workflows         |
| Framework     | Hono                         |
| Language      | TypeScript                   |
| AI SDK        | Vercel AI SDK (`ai` package) |
| Observability | Langfuse                     |
