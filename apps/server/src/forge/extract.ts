import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import type { Scene, Transition, NPC, Item, SceneGraph } from "@questforge/shared";

// ---------------------------------------------------------------------------
// Input type — what callers pass in
// ---------------------------------------------------------------------------

export interface ExtractionChunk {
  text: string;
  chunkIndex: number;
}

// ---------------------------------------------------------------------------
// Zod schemas for structured-output extraction (kept in apps/server)
// ---------------------------------------------------------------------------

const ExtractedNPCSchema = z.object({
  name: z.string().describe("NPC name"),
  description: z.string().describe("Brief description of the NPC"),
  role: z.string().describe("NPC role (e.g. ally, villain, merchant, quest-giver)"),
});

const ExtractedItemSchema = z.object({
  name: z.string().describe("Item name"),
  description: z.string().describe("Brief description of the item"),
  properties: z.array(z.string()).describe("Notable properties (e.g. magical, cursed, rare)"),
});

const ExtractedTransitionSchema = z.object({
  from: z.string().describe("Source scene/location name"),
  to: z.string().describe("Destination scene/location name"),
  description: z.string().describe("How the transition works or what connects these locations"),
});

const ExtractedSceneSchema = z.object({
  title: z.string().describe("Scene or location name"),
  description: z.string().describe("Description of the scene"),
  type: z.enum(["location", "encounter", "event"]).describe("Scene type"),
});

const ChunkExtractionSchema = z.object({
  scenes: z.array(ExtractedSceneSchema).describe("Scenes found in this chunk"),
  npcs: z.array(ExtractedNPCSchema).describe("NPCs found in this chunk"),
  items: z.array(ExtractedItemSchema).describe("Items found in this chunk"),
  transitions: z.array(ExtractedTransitionSchema).describe("Transitions between locations"),
});

type ChunkExtraction = z.infer<typeof ChunkExtractionSchema>;

// ---------------------------------------------------------------------------
// Merge-pass Zod schema — the LLM returns the final cleaned graph
// ---------------------------------------------------------------------------

const MergedSceneSchema = z.object({
  title: z.string(),
  description: z.string(),
  type: z.enum(["location", "encounter", "event"]),
  sourceChunkIndices: z.array(z.number()),
});

const MergedNPCSchema = z.object({
  name: z.string(),
  description: z.string(),
  role: z.string(),
  sourceChunkIndices: z.array(z.number()),
});

const MergedItemSchema = z.object({
  name: z.string(),
  description: z.string(),
  properties: z.array(z.string()),
  sourceChunkIndices: z.array(z.number()),
});

const MergedTransitionSchema = z.object({
  fromScene: z.string().describe("Title of the source scene"),
  toScene: z.string().describe("Title of the destination scene"),
  description: z.string(),
  condition: z.string().optional().describe("Optional condition for using this transition"),
  sourceChunkIndices: z.array(z.number()),
});

const MergedGraphSchema = z.object({
  scenes: z.array(MergedSceneSchema),
  npcs: z.array(MergedNPCSchema),
  items: z.array(MergedItemSchema),
  transitions: z.array(MergedTransitionSchema),
});

type MergedGraph = z.infer<typeof MergedGraphSchema>;

// ---------------------------------------------------------------------------
// OpenAI client (reuses the embedder pattern)
// ---------------------------------------------------------------------------

const EXTRACTION_MODEL = "gpt-4o-mini";
const CONCURRENCY_LIMIT = 5;

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY environment variable is not set. Set it in your .env file.",
      );
    }
    client = new OpenAI({ apiKey });
  }
  return client;
}

// ---------------------------------------------------------------------------
// Pass 1 — Extract entities from a single chunk
// ---------------------------------------------------------------------------

const CHUNK_SYSTEM_PROMPT = `You are a D&D campaign content extractor. Given a chunk of campaign text, extract all scenes (locations, encounters, events), NPCs, items, and transitions between locations. Be thorough but only extract entities that are actually present in the text. If no entities of a type are found, return an empty array for that type.`;

async function extractChunk(chunk: ExtractionChunk): Promise<{ chunkIndex: number; extraction: ChunkExtraction }> {
  const openai = getClient();

  const completion = await openai.chat.completions.parse({
    model: EXTRACTION_MODEL,
    messages: [
      { role: "system", content: CHUNK_SYSTEM_PROMPT },
      { role: "user", content: chunk.text },
    ],
    response_format: zodResponseFormat(ChunkExtractionSchema, "chunk_extraction"),
  });

  const message = completion.choices[0]?.message;
  if (!message?.parsed) {
    throw new Error(
      `Extraction failed for chunk ${chunk.chunkIndex}: model returned no parsed content. ` +
      (message?.refusal ? `Refusal: ${message.refusal}` : "Unknown error."),
    );
  }

  return { chunkIndex: chunk.chunkIndex, extraction: message.parsed };
}

// ---------------------------------------------------------------------------
// Pass 1 — Process all chunks with concurrency limit
// ---------------------------------------------------------------------------

async function extractAllChunks(
  chunks: ExtractionChunk[],
): Promise<{ chunkIndex: number; extraction: ChunkExtraction }[]> {
  const results: { chunkIndex: number; extraction: ChunkExtraction }[] = [];

  // Process in batches of CONCURRENCY_LIMIT
  for (let i = 0; i < chunks.length; i += CONCURRENCY_LIMIT) {
    const batch = chunks.slice(i, i + CONCURRENCY_LIMIT);
    const batchResults = await Promise.all(batch.map(extractChunk));
    results.push(...batchResults);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Pass 2 — Merge & deduplicate via LLM
// ---------------------------------------------------------------------------

const MERGE_SYSTEM_PROMPT = `You are a D&D campaign graph merger. You receive raw extracted entities from multiple chunks of a campaign document. Your job is to:

1. **Deduplicate** — merge entities that refer to the same thing (e.g. "The Rusty Dagger Inn" and "Rusty Dagger" are the same scene). Union their sourceChunkIndices.
2. **Resolve transitions** — ensure "fromScene" and "toScene" match actual scene titles in your output.
3. **Clean up** — fix inconsistencies, merge partial descriptions, remove duplicates.
4. **Preserve all source chunk indices** — every entity must list all chunk indices it was found in.

Return a single coherent scene graph with no duplicates.`;

function buildMergeCandidates(
  chunkResults: { chunkIndex: number; extraction: ChunkExtraction }[],
): string {
  const candidates: {
    scenes: Array<{ title: string; description: string; type: string; sourceChunkIndices: number[] }>;
    npcs: Array<{ name: string; description: string; role: string; sourceChunkIndices: number[] }>;
    items: Array<{ name: string; description: string; properties: string[]; sourceChunkIndices: number[] }>;
    transitions: Array<{ from: string; to: string; description: string; sourceChunkIndices: number[] }>;
  } = { scenes: [], npcs: [], items: [], transitions: [] };

  for (const { chunkIndex, extraction } of chunkResults) {
    for (const scene of extraction.scenes) {
      candidates.scenes.push({ ...scene, sourceChunkIndices: [chunkIndex] });
    }
    for (const npc of extraction.npcs) {
      candidates.npcs.push({ ...npc, sourceChunkIndices: [chunkIndex] });
    }
    for (const item of extraction.items) {
      candidates.items.push({ ...item, sourceChunkIndices: [chunkIndex] });
    }
    for (const transition of extraction.transitions) {
      candidates.transitions.push({ ...transition, sourceChunkIndices: [chunkIndex] });
    }
  }

  return JSON.stringify(candidates, null, 2);
}

async function mergeExtractions(
  chunkResults: { chunkIndex: number; extraction: ChunkExtraction }[],
): Promise<MergedGraph> {
  const openai = getClient();
  const candidatesJson = buildMergeCandidates(chunkResults);

  const completion = await openai.chat.completions.parse({
    model: EXTRACTION_MODEL,
    messages: [
      { role: "system", content: MERGE_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Here are the raw extracted entities from ${chunkResults.length} chunks:\n\n${candidatesJson}\n\nMerge and deduplicate these into a single coherent scene graph.`,
      },
    ],
    response_format: zodResponseFormat(MergedGraphSchema, "merged_graph"),
  });

  const message = completion.choices[0]?.message;
  if (!message?.parsed) {
    throw new Error(
      "Merge pass failed: model returned no parsed content. " +
      (message?.refusal ? `Refusal: ${message.refusal}` : "Unknown error."),
    );
  }

  return message.parsed;
}

// ---------------------------------------------------------------------------
// Convert merged LLM output → SceneGraph with stable IDs
// ---------------------------------------------------------------------------

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

function toSceneGraph(
  merged: MergedGraph,
  meta: { campaignId: string; campaignName: string },
  sourceChunkCount: number,
): SceneGraph {
  const scenes: Scene[] = merged.scenes.map((s) => ({
    id: `scene-${slugify(s.title)}`,
    title: s.title,
    description: s.description,
    sceneType: s.type,
    npcs: [],
    items: [],
    sourceChunkIndices: s.sourceChunkIndices,
  }));

  // Build a title→id lookup for transitions
  const sceneTitleToId = new Map<string, string>();
  for (const scene of scenes) {
    sceneTitleToId.set(scene.title.toLowerCase(), scene.id);
  }

  const npcs: NPC[] = merged.npcs.map((n) => ({
    id: `npc-${slugify(n.name)}`,
    name: n.name,
    description: n.description,
    role: n.role,
    sourceChunkIndices: n.sourceChunkIndices,
  }));

  const items: Item[] = merged.items.map((item) => ({
    id: `item-${slugify(item.name)}`,
    name: item.name,
    description: item.description,
    properties: item.properties.length > 0 ? { tags: item.properties } : undefined,
    sourceChunkIndices: item.sourceChunkIndices,
  }));

  const transitions: Transition[] = merged.transitions
    .map((t): Transition | null => {
      const fromId = sceneTitleToId.get(t.fromScene.toLowerCase());
      const toId = sceneTitleToId.get(t.toScene.toLowerCase());
      // Only include transitions where both scenes exist
      if (!fromId || !toId) return null;
      return {
        id: `trans-${slugify(t.fromScene)}-to-${slugify(t.toScene)}`,
        fromSceneId: fromId,
        toSceneId: toId,
        description: t.description,
        ...(t.condition !== undefined && { condition: t.condition }),
        sourceChunkIndices: t.sourceChunkIndices,
      };
    })
    .filter((t): t is Transition => t !== null);

  return {
    campaignId: meta.campaignId,
    campaignName: meta.campaignName,
    model: EXTRACTION_MODEL,
    createdAt: new Date().toISOString(),
    sourceChunkCount,
    schemaVersion: 1,
    scenes,
    transitions,
    npcs,
    items,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract a scene graph from campaign text chunks using a two-pass LLM approach.
 *
 * Pass 1: Extract candidate entities from each chunk (concurrency-limited).
 * Pass 2: Merge all candidates into a single deduplicated SceneGraph via LLM.
 *
 * Fails immediately if any chunk extraction fails — no partial graphs.
 */
export async function extractFromChunks(
  chunks: ExtractionChunk[],
  meta: { campaignId: string; campaignName: string },
): Promise<SceneGraph> {
  const emptyGraph: SceneGraph = {
    campaignId: meta.campaignId,
    campaignName: meta.campaignName,
    model: EXTRACTION_MODEL,
    createdAt: new Date().toISOString(),
    sourceChunkCount: chunks.length,
    schemaVersion: 1,
    scenes: [],
    transitions: [],
    npcs: [],
    items: [],
  };

  if (chunks.length === 0) {
    return emptyGraph;
  }

  // Pass 1 — extract entities from each chunk
  const chunkResults = await extractAllChunks(chunks);

  // If all chunks returned empty extractions, return empty graph
  const hasContent = chunkResults.some(
    (r) =>
      r.extraction.scenes.length > 0 ||
      r.extraction.npcs.length > 0 ||
      r.extraction.items.length > 0 ||
      r.extraction.transitions.length > 0,
  );
  if (!hasContent) {
    return emptyGraph;
  }

  // Pass 2 — merge & deduplicate
  const merged = await mergeExtractions(chunkResults);

  return toSceneGraph(merged, meta, chunks.length);
}
