import { QdrantClient } from "@qdrant/js-client-rest";

let client: QdrantClient | null = null;

function getClient(): QdrantClient {
  if (!client) {
    const url = process.env.QDRANT_URL ?? "http://localhost:6333";
    client = new QdrantClient({ url });
  }
  return client;
}

export interface ChunkRecord {
  text: string;
  chunkIndex: number;
}

/**
 * Fetch all `type=chunk` points from a campaign's Qdrant collection,
 * returned in ascending `chunkIndex` order.
 *
 * Uses scroll pagination to retrieve every chunk regardless of collection size.
 */
export async function fetchAllChunks(
  campaignId: string,
): Promise<ChunkRecord[]> {
  const collectionName = `campaign-${campaignId}`;
  const qdrant = getClient();

  const chunks: ChunkRecord[] = [];
  let offset: string | number | undefined = undefined;

  // Scroll through all points matching type=chunk
  for (;;) {
    const response = await qdrant.scroll(collectionName, {
      filter: {
        must: [{ key: "type", match: { value: "chunk" } }],
      },
      with_payload: true,
      with_vector: false,
      limit: 100,
      offset,
    });

    for (const point of response.points) {
      const payload = point.payload as Record<string, unknown> | null;
      if (payload) {
        chunks.push({
          text: payload.text as string,
          chunkIndex: payload.chunkIndex as number,
        });
      }
    }

    if (response.next_page_offset == null) break;
    offset = response.next_page_offset as string | number;
  }

  // Sort by chunkIndex to guarantee stable document order
  chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);

  return chunks;
}
