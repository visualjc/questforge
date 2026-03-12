/** Represents a TTRPG campaign with its ingestion metadata. */
export interface Campaign {
  id: string;
  name: string;
  sourceFile: string;
  createdAt: string;
  chunksCount: number;
}

/** A single text chunk from a campaign PDF, ready for embedding storage. */
export interface CampaignChunk {
  id: string;
  campaignId: string;
  text: string;
  chunkIndex: number;
  metadata: {
    sourceFile: string;
  };
}
