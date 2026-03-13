import { parsePdf } from "./pdf-parser.js";
import { chunkText } from "./chunker.js";
import { embedChunks } from "./embedder.js";
import { storeAll } from "./store.js";
import type { Campaign } from "@questforge/shared";
import path from "node:path";

export interface IngestResult {
  campaignId: string;
  collectionName: string;
  chunksCount: number;
}

/** Slugify a campaign name into a URL/collection-safe string. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Ingest a PDF file into the vector store.
 *
 * Flow: parse PDF → chunk text → generate embeddings → store in Qdrant.
 */
export async function ingestPdf(
  filePath: string,
  campaignName: string,
): Promise<IngestResult> {
  const campaignId = slugify(campaignName);
  const collectionName = `campaign-${campaignId}`;
  const sourceFile = path.basename(filePath);

  // 1. Parse PDF
  const text = await parsePdf(filePath);

  // 2. Chunk text
  const chunks = chunkText(text);

  if (chunks.length === 0) {
    throw new Error(`No chunks produced from PDF: ${filePath}`);
  }

  // 3. Generate embeddings
  const embeddings = await embedChunks(chunks);

  // 4. Build campaign metadata
  const campaign: Campaign = {
    id: campaignId,
    name: campaignName,
    sourceFile,
    createdAt: new Date().toISOString(),
    chunksCount: chunks.length,
  };

  // 5. Store in Qdrant
  await storeAll(collectionName, chunks, embeddings, campaign);

  return {
    campaignId,
    collectionName,
    chunksCount: chunks.length,
  };
}
