# QuestForge

Turn tabletop campaign PDFs into playable interactive fiction.

QuestForge is a D&D campaign management toolkit built as a Bun monorepo. It ingests campaign PDF documents, chunks and embeds them, and stores the vectors in Qdrant for semantic retrieval via an MCP server.

## Prerequisites

- [Bun](https://bun.sh/) (v1.1+)
- [Docker](https://www.docker.com/) (for Qdrant)
- An [OpenAI API key](https://platform.openai.com/api-keys) (for embeddings)

## Quick Start

```bash
# Start Qdrant
docker compose up -d

# Configure environment
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY

# Install dependencies
bun install

# Ingest a campaign PDF
bun run apps/cli/src/index.ts ingest path/to/campaign.pdf

# List campaigns
bun run apps/cli/src/index.ts campaigns list
```

## Environment Variables

| Variable | Required | Description | Default |
|---|---|---|---|
| `OPENAI_API_KEY` | Yes | OpenAI API key for generating embeddings | — |
| `QDRANT_URL` | No | Qdrant instance URL | `http://localhost:6333` |
| `QUESTFORGE_BUN_BIN` | No | Override path to the Bun binary | `process.execPath` |
| `NODE_ENV` | No | Runtime mode (`development`, `production`) | — |

## Architecture

```
CLI (Commander.js)
  └─ spawns → MCP Server (FastMCP, child process via StdioClientTransport)
                ├─ PDF ingestion pipeline (pdf-parse → chunking → OpenAI embeddings)
                └─ Qdrant vector store (campaigns, semantic search)
```

The CLI spawns the MCP server as a subprocess. **Only explicitly listed environment variables are forwarded** to the server process. See `apps/cli/src/client.ts` for the allowlist (`FORWARDED_ENV_VARS`). When adding new env vars that the server needs, update both `.env.example` and the forwarding list.

## Project Structure

```
apps/
  cli/          — Commander.js CLI client
  server/       — FastMCP server (ingestion, vector store, tools)
packages/
  shared/       — Shared types and utilities
```

## Development

```bash
# Type-check
bunx tsc --noEmit

# Generate test PDF fixture
bun run scripts/generate-test-pdf.ts

# Run end-to-end (requires Qdrant + .env)
bun run apps/cli/src/index.ts ingest test-data/sample-campaign.pdf
bun run apps/cli/src/index.ts campaigns list
```
