import { QdrantClient } from "@qdrant/js-client-rest";
import type { SceneGraph } from "@questforge/shared";
import { fetchAllChunks } from "./retrieve.js";
import { extractFromChunks } from "./extract.js";
import { enrichGraph } from "./enrich.js";
import { storeGraph } from "./store-graph.js";

let client: QdrantClient | null = null;

function getClient(): QdrantClient {
  if (!client) {
    const url = process.env.QDRANT_URL ?? "http://localhost:6333";
    client = new QdrantClient({ url });
  }
  return client;
}

const METADATA_POINT_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Look up a campaign's name from its metadata point in Qdrant.
 */
async function getCampaignName(campaignId: string): Promise<string> {
  const qdrant = getClient();
  const collectionName = `campaign-${campaignId}`;

  const points = await qdrant.retrieve(collectionName, {
    ids: [METADATA_POINT_ID],
    with_payload: true,
  });

  if (points.length === 0 || !points[0].payload) {
    throw new Error(
      `Campaign "${campaignId}" not found. Has it been ingested?`,
    );
  }

  const payload = points[0].payload as Record<string, unknown>;
  return (payload.name as string) ?? campaignId;
}

/**
 * Orchestrate the full forge pipeline:
 * 1. Look up campaign name from metadata
 * 2. Fetch all chunks
 * 3. Extract scene graph via LLM
 * 4. Store graph in Qdrant
 * 5. Return the graph
 */
export async function forgeCampaign(
  campaignId: string,
): Promise<SceneGraph> {
  // Step 1: Get campaign name
  const campaignName = await getCampaignName(campaignId);

  // Step 2: Fetch chunks
  const chunks = await fetchAllChunks(campaignId);
  if (chunks.length === 0) {
    throw new Error(
      `No chunks found for campaign "${campaignId}". Was the PDF ingested correctly?`,
    );
  }

  // Step 3: Extract scene graph
  const graph = await extractFromChunks(chunks, { campaignId, campaignName });

  // Step 4: Enrich, repair, and validate for playability
  const enrichedGraph = await enrichGraph(graph, chunks);

  // Step 5: Store in Qdrant (even if not play-ready, so user can inspect with 'graph')
  await storeGraph(enrichedGraph);

  // Step 6: Fail if graph is not play-ready
  if (enrichedGraph.playReady !== true) {
    throw new Error(
      "Forge completed but the graph is not play-ready. Some scenes have no exits after enrichment. " +
      "Inspect with 'graph " + campaignId + "' and check campaign content."
    );
  }

  return enrichedGraph;
}
