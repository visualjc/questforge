import { z } from "zod";
import type { FastMCP } from "fastmcp";
import { QdrantClient } from "@qdrant/js-client-rest";

export function registerListCampaignsTool(server: FastMCP) {
  server.addTool({
    name: "list_campaigns",
    description: "Lists all available campaigns stored in Qdrant",
    parameters: z.object({}),
    execute: async () => {
      const url = process.env.QDRANT_URL ?? "http://localhost:6333";
      let qdrant: QdrantClient;
      try {
        qdrant = new QdrantClient({ url });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : String(err);
        return JSON.stringify({
          campaigns: [],
          message: `Failed to connect to Qdrant: ${message}`,
        });
      }

      let collections: Awaited<
        ReturnType<QdrantClient["getCollections"]>
      >;
      try {
        collections = await qdrant.getCollections();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : String(err);
        return JSON.stringify({
          campaigns: [],
          message: `Qdrant is not reachable at ${url}. Is it running? (${message})`,
        });
      }

      const campaignCollections = collections.collections.filter((c) =>
        c.name.startsWith("campaign-"),
      );

      if (campaignCollections.length === 0) {
        return JSON.stringify({
          campaigns: [],
          message: "No campaigns found. Use 'ingest' to add one.",
        });
      }

      const METADATA_POINT_ID = "00000000-0000-0000-0000-000000000000";
      const campaigns = [];

      for (const col of campaignCollections) {
        try {
          const points = await qdrant.retrieve(col.name, {
            ids: [METADATA_POINT_ID],
            with_payload: true,
          });

          if (points.length > 0 && points[0].payload) {
            const p = points[0].payload as Record<string, unknown>;
            campaigns.push({
              id: p.campaignId,
              name: p.name,
              chunksCount: p.chunksCount,
              createdAt: p.createdAt,
              sourceFile: p.sourceFile,
            });
          }
        } catch {
          // Skip collections we can't read metadata from
        }
      }

      return JSON.stringify({
        campaigns,
        message:
          campaigns.length === 0
            ? "No campaigns found. Use 'ingest' to add one."
            : `Found ${campaigns.length} campaign(s)`,
      });
    },
  });
}
