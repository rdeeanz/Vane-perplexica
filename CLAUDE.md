# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start Next.js dev server on port 3000
npm run build        # Production build (--webpack, NOT Turbopack)
npm run start        # Start production server
npm run lint         # ESLint with next/core-web-vitals config
npm run format:write # Prettier: single quotes, 80 print width, trailing commas, 2-space tabs
```

Database migrations run automatically at server startup via `src/instrumentation.ts`. They use a custom migration runner (`src/lib/db/migrate.ts`) that reads SQL files from `drizzle/`, not Drizzle Kit's built-in migrator, so Drizzle Kit is only used for schema generation. SQLite database and JSON config both live in `data/` at the project root (or `DATA_DIR` env var).

## Architecture

Vane is a **Next.js 16 App Router** application — an AI-powered answering engine that combines web search (via SearXNG) with LLM-generated responses. It runs as a standalone Node.js server (`output: 'standalone'` in next.config.mjs).

### Request flow for a chat message

1. **`POST /api/chat`** (UI) or **`POST /api/search`** (programmatic API) receives the query
2. A `SessionManager` (in-memory event emitter, 30-min TTL) is created — it carries streaming blocks to the client over SSE
3. **Classification** (`src/lib/agents/search/classifier.ts`): The LLM decides whether to skip search, which search sources to use, and which widgets to show
4. **Widgets and Research run in parallel**:
   - **Widgets** (`src/lib/agents/search/widgets/`): Weather, stocks, calculations — shown in the UI but not cited
   - **Researcher** (`src/lib/agents/search/researcher/`): An iterative agent loop that calls registered action tools (web search, academic search, social/discussions search, URL scraping, uploads search) until it gathers enough information or hits iteration limits (speed: 2, balanced: 6, quality: 25)
5. **Writer** (`src/lib/prompts/search/writer.ts`): The final LLM call generates a cited, blog-style answer from the gathered context
6. Response is streamed back as SSE with typed blocks: `text`, `source`, `suggestion`, `widget`, and `research` (which contains sub-steps like reasoning, searching, reading)

### Key architectural concepts

**SessionManager** (`src/lib/session.ts`): In-memory pub/sub with block storage and event replay. Sessions are stored in a global Map (dev-mode HMR safe). Clients subscribe to receive block emissions and updates. This is the core streaming mechanism — not WebSockets, not Server-Sent Events directly; the route handler bridges SessionManager events to an SSE `TransformStream`.

**Block system** (`src/lib/types.ts`): All UI output is represented as typed blocks — `TextBlock`, `SourceBlock`, `WidgetBlock`, `ResearchBlock` (with sub-steps), `SuggestionBlock`. Blocks are created via `session.emitBlock()`, updated via `session.updateBlock()` with RFC 6902 JSON patches.

**Config system** (`src/lib/config/`): JSON file at `data/config.json`. `ConfigManager` is a singleton that manages preferences, personalization, model providers, and search settings. UI field definitions are declared in code with `scope: 'client' | 'server'` to control what's exposed. Environment variables (e.g., `SEARXNG_API_URL`) can pre-populate config on startup.

**Model providers** (`src/lib/models/`): Abstract base classes (`BaseLLM`, `BaseEmbedding`, `BaseModelProvider`) define the contract. Concrete providers (`src/lib/models/providers/`) implement OpenAI, Anthropic, Gemini, Ollama, Groq, Transformers (HuggingFace), Lemonade, and LM Studio. The `ModelRegistry` loads configured providers and resolves chat/embedding models by provider ID + model key.

**Researcher actions** (`src/lib/agents/search/researcher/actions/`): Each action has a name, Zod schema, tool description, and execute function. Actions are registered into `ActionRegistry`. The researcher loop streams tool calls from the LLM, executes matching actions, and feeds tool results back. Quality mode demands `__reasoning_preamble` tool calls between every step.

**Database** (`src/lib/db/`): SQLite via better-sqlite3 + Drizzle ORM. Two main tables: `chats` (id, title, sources, files) and `messages` (messageId, chatId, query, responseBlocks as JSON, status). Migrations are applied from `drizzle/` SQL files by a custom runner.

**Uploads** (`src/lib/uploads/manager.ts`): Files (PDF, DOCX, plain text) are processed by extracting text, splitting into chunks with overlap, generating embeddings, and storing chunk+embedding pairs. Upload search uses cosine similarity to find relevant chunks.

**Scraper** (`src/lib/scraper.ts`): Uses Playwright (headless Chromium) with an idle-kill pool pattern — browser launches on demand, auto-closes after 30s of inactivity.

**Prompts** (`src/lib/prompts/search/`): Researcher prompt varies by mode (speed/balanced/quality) with different tool-call strategies. Writer prompt instructs the LLM to produce cited, blog-style answers. Classifier prompt decides search strategy and widget relevance.

**Search modes**: `speed` (2 researcher iterations, fast answer), `balanced` (6 iterations, moderate depth), `quality` (25 iterations, 2000+ word research-report style answer).

### App router structure

- **`/`** — Home page with empty chat input, weather/news widgets
- **`/c/[chatId]`** — Chat conversation page
- **`/discover`** — Trending news/articles
- **`/library`** — Saved/uploaded files
- **`/api/chat`** — Main SSE streaming chat endpoint (UI)
- **`/api/search`** — Programmatic search API (supports both streaming and non-streaming)
- **`/api/config`** — Read/write app configuration
- **`/api/providers`** — List active model providers and their models

### Docker

Two Dockerfiles: `Dockerfile` (full — bundles SearXNG), `Dockerfile.slim` (just Vane, expects external SearXNG). Both use Node 24.5.0-slim and Playwright for scraping. The entrypoint starts both SearXNG (via uWSGI) and the Next.js server.
