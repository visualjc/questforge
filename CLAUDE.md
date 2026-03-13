# QuestForge

D&D campaign management toolkit — CLI + MCP server.

## Project Structure

Bun monorepo with three workspaces:

- `apps/cli` — Commander.js CLI that spawns the MCP server
- `apps/server` — FastMCP server (PDF ingestion, Qdrant vector store)
- `packages/shared` — Shared types and utilities

## Key Commands

```bash
bun install            # Install dependencies
bunx tsc --noEmit      # Type-check the project
docker compose up -d   # Start Qdrant (required for server)
```

## Environment Variables

Copy `.env.example` to `.env` and fill in values. Required:

- `OPENAI_API_KEY` — OpenAI API key for embeddings
- `QDRANT_URL` — Qdrant instance URL (default: `http://localhost:6333`)

## Env Var Forwarding Convention

The CLI spawns the MCP server as a child process via `StdioClientTransport`. **Only explicitly listed env vars are forwarded** to the server process.

When adding a new env var that the server needs, you **MUST** add it to the `FORWARDED_ENV_VARS` array in `apps/cli/src/client.ts`.

Currently forwarded vars:

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | OpenAI embeddings |
| `QDRANT_URL` | Vector store connection |
| `QUESTFORGE_BUN_BIN` | Bun binary override |
| `PATH` | Process execution |
| `HOME` | System context |
| `USER` | System context |
| `SHELL` | System context |
| `TERM` | Terminal context |
| `NODE_ENV` | Runtime mode |

## Test Fixtures

`test-data/sample-campaign.pdf` is a generated fixture — do not commit it. Run `bun run fixture:pdf` to create it before manual e2e verification. The generator script `scripts/generate-test-pdf.ts` is the source of truth for fixture content.
