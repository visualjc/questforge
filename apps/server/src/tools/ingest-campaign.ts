import { z } from "zod";
import type { FastMCP } from "fastmcp";
import { ingestPdf } from "../ingest/pipeline.js";
import path from "node:path";
import fs from "node:fs";

export function registerIngestCampaignTool(server: FastMCP) {
  server.addTool({
    name: "ingest_campaign",
    description:
      "Ingest a PDF campaign file into the vector store. Parses, chunks, embeds, and stores the content.",
    parameters: z.object({
      filePath: z.string().describe("Absolute path to the PDF file"),
      name: z
        .string()
        .optional()
        .describe(
          "Campaign name (defaults to filename without extension)",
        ),
    }),
    execute: async (args) => {
      // Validate file exists
      const resolvedPath = path.resolve(args.filePath);
      if (!fs.existsSync(resolvedPath)) {
        return JSON.stringify({
          error: `File not found: ${resolvedPath}`,
        });
      }

      // Validate OPENAI_API_KEY
      if (!process.env.OPENAI_API_KEY) {
        return JSON.stringify({
          error:
            "OPENAI_API_KEY environment variable is not set. Required for generating embeddings.",
        });
      }

      // Derive campaign name from filename if not provided
      const campaignName =
        args.name ?? path.basename(resolvedPath, path.extname(resolvedPath));

      try {
        const result = await ingestPdf(resolvedPath, campaignName);
        return JSON.stringify({
          campaignId: result.campaignId,
          collectionName: result.collectionName,
          chunksCount: result.chunksCount,
          message: `Successfully ingested "${campaignName}" (${result.chunksCount} chunks)`,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: message });
      }
    },
  });
}
