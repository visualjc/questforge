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

// ---------------------------------------------------------------------------
// Scene Graph types
// ---------------------------------------------------------------------------

/** A scene within a campaign (location, encounter, or event). */
export interface Scene {
  id: string;
  title: string;
  description: string;
  sceneType: "location" | "encounter" | "event";
  npcs: string[];
  items: string[];
  sourceChunkIndices: number[];
  isTerminal?: boolean;
}

/** A directional link between two scenes. */
export interface Transition {
  id: string;
  fromSceneId: string;
  toSceneId: string;
  description: string;
  condition?: string;
  sourceChunkIndices: number[];
}

/** A non-player character extracted from campaign text. */
export interface NPC {
  id: string;
  name: string;
  description: string;
  role: string;
  stats?: Record<string, unknown>;
  sourceChunkIndices: number[];
}

/** An item or object extracted from campaign text. */
export interface Item {
  id: string;
  name: string;
  description: string;
  properties?: Record<string, unknown>;
  sourceChunkIndices: number[];
}

/** The full scene graph for a campaign, with metadata envelope. */
export interface SceneGraph {
  campaignId: string;
  campaignName: string;
  model: string;
  createdAt: string;
  sourceChunkCount: number;
  schemaVersion: number;
  scenes: Scene[];
  transitions: Transition[];
  npcs: NPC[];
  items: Item[];
  playReady?: boolean;
}

// ---------------------------------------------------------------------------
// Play Session types
// ---------------------------------------------------------------------------

/** An interactive play session tracking player progress through a campaign. */
export interface PlaySession {
  sessionId: string;
  campaignId: string;
  currentSceneId: string;
  visitedSceneIds: string[];
  inventory: string[];
  flags: Record<string, boolean>;
  createdAt: string;
  updatedAt: string;
}
