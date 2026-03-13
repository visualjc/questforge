import { QdrantClient } from "@qdrant/js-client-rest";
import type { SceneGraph } from "@questforge/shared";

let client: QdrantClient | null = null;

function getClient(): QdrantClient {
  if (!client) {
    const url = process.env.QDRANT_URL ?? "http://localhost:6333";
    client = new QdrantClient({ url });
  }
  return client;
}

function collectionName(campaignId: string): string {
  return `graph-${campaignId}`;
}

const GRAPH_POINT_ID = 1;

/**
 * Store a scene graph as a single payload document in Qdrant.
 * Ensures the collection exists, then upserts the graph point atomically.
 */
export async function storeGraph(graph: SceneGraph): Promise<void> {
  const qdrant = getClient();
  const name = collectionName(graph.campaignId);

  // Ensure collection exists (create if missing, ignore "already exists")
  try {
    await qdrant.createCollection(name, {
      vectors: { size: 1, distance: "Cosine" },
    });
  } catch {
    // Collection already exists — that's fine
  }

  // Upsert the graph as a single point (replaces payload atomically)
  await qdrant.upsert(name, {
    wait: true,
    points: [
      {
        id: GRAPH_POINT_ID,
        vector: [0],
        payload: graph as unknown as Record<string, unknown>,
      },
    ],
  });
}

/**
 * Load a scene graph from Qdrant by campaign ID.
 * Returns null if no graph collection exists.
 */
export async function loadGraph(
  campaignId: string,
): Promise<SceneGraph | null> {
  const qdrant = getClient();
  const name = collectionName(campaignId);

  try {
    const points = await qdrant.retrieve(name, {
      ids: [GRAPH_POINT_ID],
      with_payload: true,
    });

    if (points.length === 0 || !points[0].payload) {
      return null;
    }

    return points[0].payload as unknown as SceneGraph;
  } catch (err) {
    // Only treat "collection not found" as null — let connection errors propagate
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Not found") || message.includes("doesn't exist")) {
      return null;
    }
    throw err;
  }
}

/**
 * Delete the graph collection for a campaign.
 */
export async function deleteGraph(campaignId: string): Promise<void> {
  const qdrant = getClient();
  const name = collectionName(campaignId);

  try {
    await qdrant.deleteCollection(name);
  } catch {
    // Collection may not exist — that's fine
  }
}
