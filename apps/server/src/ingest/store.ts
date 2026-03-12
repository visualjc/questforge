import { QdrantClient } from "@qdrant/js-client-rest";
import { DIMENSIONS } from "./embedder.js";
import type { Campaign } from "@questforge/shared";

const METADATA_POINT_ID = "00000000-0000-0000-0000-000000000000";

let client: QdrantClient | null = null;

function getClient(): QdrantClient {
  if (!client) {
    const url = process.env.QDRANT_URL ?? "http://localhost:6333";
    client = new QdrantClient({ url });
  }
  return client;
}

/** Ensure the Qdrant collection exists, creating it if needed. */
async function ensureCollection(collectionName: string): Promise<void> {
  const qdrant = getClient();

  const collections = await qdrant.getCollections();
  const exists = collections.collections.some(
    (c) => c.name === collectionName,
  );

  if (!exists) {
    await qdrant.createCollection(collectionName, {
      vectors: { size: DIMENSIONS, distance: "Cosine" },
    });
  }
}

/** Store campaign metadata as a special point in the collection. */
async function storeCampaignMetadata(
  collectionName: string,
  campaign: Campaign,
): Promise<void> {
  const qdrant = getClient();

  await qdrant.upsert(collectionName, {
    points: [
      {
        id: METADATA_POINT_ID,
        vector: new Array(DIMENSIONS).fill(0),
        payload: {
          type: "campaign_metadata",
          campaignId: campaign.id,
          name: campaign.name,
          sourceFile: campaign.sourceFile,
          createdAt: campaign.createdAt,
          chunksCount: campaign.chunksCount,
        },
      },
    ],
  });
}

/** Store text chunks with their embedding vectors in Qdrant. */
export async function storeChunks(
  collectionName: string,
  chunks: string[],
  embeddings: number[][],
  campaignId: string,
  sourceFile: string,
): Promise<void> {
  const qdrant = getClient();

  await ensureCollection(collectionName);

  // Delete existing chunks so re-ingest replaces rather than duplicates
  await qdrant.delete(collectionName, {
    filter: {
      must: [{ key: "type", match: { value: "chunk" } }],
    },
  });

  const points = chunks.map((text, i) => ({
    id: crypto.randomUUID(),
    vector: embeddings[i],
    payload: {
      text,
      chunkIndex: i,
      sourceFile,
      campaignId,
      type: "chunk",
    },
  }));

  // Upsert in batches of 100
  const BATCH_SIZE = 100;
  for (let i = 0; i < points.length; i += BATCH_SIZE) {
    const batch = points.slice(i, i + BATCH_SIZE);
    await qdrant.upsert(collectionName, { points: batch });
  }
}

/** Store both chunks and campaign metadata in Qdrant. */
export async function storeAll(
  collectionName: string,
  chunks: string[],
  embeddings: number[][],
  campaign: Campaign,
): Promise<void> {
  await storeChunks(
    collectionName,
    chunks,
    embeddings,
    campaign.id,
    campaign.sourceFile,
  );
  await storeCampaignMetadata(collectionName, campaign);
}
