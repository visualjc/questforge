import { QdrantClient } from "@qdrant/js-client-rest";
import type { PlaySession } from "@questforge/shared";

let client: QdrantClient | null = null;

function getClient(): QdrantClient {
  if (!client) {
    const url = process.env.QDRANT_URL ?? "http://localhost:6333";
    client = new QdrantClient({ url });
  }
  return client;
}

function collectionName(sessionId: string): string {
  return `session-${sessionId}`;
}

const SESSION_POINT_ID = 1;

/**
 * Generate a unique session ID for a campaign.
 */
export function generateSessionId(campaignId: string): string {
  return `${campaignId}-${Date.now().toString(36)}`;
}

/**
 * Store a play session as a single payload document in Qdrant.
 * Ensures the collection exists, then upserts the session point atomically.
 */
export async function saveSession(session: PlaySession): Promise<void> {
  const qdrant = getClient();
  const name = collectionName(session.sessionId);

  // Ensure collection exists (create if missing, ignore "already exists")
  try {
    await qdrant.createCollection(name, {
      vectors: { size: 1, distance: "Cosine" },
    });
  } catch {
    // Collection already exists — that's fine
  }

  // Upsert the session as a single point (replaces payload atomically)
  await qdrant.upsert(name, {
    wait: true,
    points: [
      {
        id: SESSION_POINT_ID,
        vector: [0],
        payload: session as unknown as Record<string, unknown>,
      },
    ],
  });
}

/**
 * Load a play session from Qdrant by session ID.
 * Returns null if no session collection exists.
 */
export async function loadSession(
  sessionId: string,
): Promise<PlaySession | null> {
  const qdrant = getClient();
  const name = collectionName(sessionId);

  try {
    const points = await qdrant.retrieve(name, {
      ids: [SESSION_POINT_ID],
      with_payload: true,
    });

    if (points.length === 0 || !points[0].payload) {
      return null;
    }

    return points[0].payload as unknown as PlaySession;
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
 * Delete the session collection.
 */
export async function deleteSession(sessionId: string): Promise<void> {
  const qdrant = getClient();
  const name = collectionName(sessionId);

  try {
    await qdrant.deleteCollection(name);
  } catch {
    // Collection may not exist — that's fine
  }
}

/**
 * List all sessions for a campaign.
 * TODO: Implement in Stage 5 — requires a session index or collection iteration.
 */
export async function listSessions(
  _campaignId: string,
): Promise<PlaySession[]> {
  // TODO: Implement session listing (Stage 5).
  // Options: iterate Qdrant collections matching `session-*` and filter by campaignId,
  // or maintain a centralized session index collection.
  return [];
}
