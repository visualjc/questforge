import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import type { SceneGraph, Transition } from "@questforge/shared";
import { slugify } from "./extract.js";
import { findStartingScene } from "../play/engine.js";

// ---------------------------------------------------------------------------
// OpenAI client (same pattern as extract.ts)
// ---------------------------------------------------------------------------

const ENRICHMENT_MODEL = "gpt-4o-mini";

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
// Zod schema for enrichment response
// ---------------------------------------------------------------------------

const EnrichmentResponseSchema = z.object({
  result: z.object({
    addedTransitions: z.array(
      z.object({
        fromScene: z.string().describe("Scene title (must match exactly)"),
        toScene: z.string().describe("Scene title (must match exactly)"),
        description: z.string().describe("How the player gets there"),
        condition: z.string().nullable().optional(),
      }),
    ),
    terminalSceneIds: z
      .array(z.string())
      .describe(
        "Scene titles that are intentional campaign endpoints (boss fight, final encounter)",
      ),
    notes: z
      .string()
      .describe("Brief summary of what was added and why"),
  }),
});

type EnrichmentResponse = z.infer<typeof EnrichmentResponseSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSceneTitleToId(
  graph: SceneGraph,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const scene of graph.scenes) {
    map.set(scene.title.toLowerCase(), scene.id);
  }
  return map;
}

function getOutgoingTransitions(
  graph: SceneGraph,
  sceneId: string,
): Transition[] {
  return graph.transitions.filter((t) => t.fromSceneId === sceneId);
}

function getDeadEndScenes(graph: SceneGraph): string[] {
  return graph.scenes
    .filter(
      (s) =>
        !s.isTerminal && getOutgoingTransitions(graph, s.id).length === 0,
    )
    .map((s) => s.id);
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildEnrichmentPrompt(
  graph: SceneGraph,
  _chunks: { text: string; chunkIndex: number }[],
): string {
  const lines: string[] = [];

  lines.push("# Campaign Scene Graph Review");
  lines.push("");
  lines.push("## Scenes (in document order)");
  graph.scenes.forEach((s, idx) => {
    const summary = s.description.slice(0, 100);
    lines.push(`${idx + 1}. "${s.title}" [${s.sceneType}] — ${summary}...`);
  });

  lines.push("");
  lines.push("## Existing Transitions");
  if (graph.transitions.length === 0) {
    lines.push("(none)");
  } else {
    for (const t of graph.transitions) {
      const fromScene = graph.scenes.find((s) => s.id === t.fromSceneId);
      const toScene = graph.scenes.find((s) => s.id === t.toSceneId);
      lines.push(
        `- "${fromScene?.title ?? t.fromSceneId}" → "${toScene?.title ?? t.toSceneId}": ${t.description}`,
      );
    }
  }

  lines.push("");
  lines.push("## Dead-End Scenes (zero outgoing transitions)");
  const deadEnds = graph.scenes.filter(
    (s) => getOutgoingTransitions(graph, s.id).length === 0,
  );
  if (deadEnds.length === 0) {
    lines.push("(none)");
  } else {
    for (const de of deadEnds) {
      const idx = graph.scenes.indexOf(de);
      const neighbors: string[] = [];
      if (idx > 0) neighbors.push(`"${graph.scenes[idx - 1].title}"`);
      if (idx < graph.scenes.length - 1)
        neighbors.push(`"${graph.scenes[idx + 1].title}"`);
      lines.push(
        `- "${de.title}" (document position ${idx + 1}, neighbors: ${neighbors.join(", ") || "none"})`,
      );
    }
  }

  return lines.join("\n");
}

const ENRICHMENT_SYSTEM_PROMPT = `You are reviewing a D&D campaign scene graph for playability. Your job is to add missing transitions so players can navigate the campaign.

Rules:
- NEVER remove existing transitions — only add new ones.
- Every non-terminal scene must have at least one outgoing transition.
- The starting scene (first scene in the list, typically with no incoming transitions) should have at least 2-3 outgoing transitions.
- Add bidirectional connections where logical (e.g. if you can go from Village to Causeway, you should be able to go back).
- Identify terminal/climax scenes (boss encounters, final rooms) that should intentionally have zero exits — list them in terminalSceneIds.
- Scene titles in your response must match the titles in the input EXACTLY.
- Make transitions feel natural and grounded in the scene descriptions.`;

// ---------------------------------------------------------------------------
// Pass 1: Connectivity Enrichment
// ---------------------------------------------------------------------------

async function runConnectivityEnrichment(
  graph: SceneGraph,
  chunks: { text: string; chunkIndex: number }[],
): Promise<EnrichmentResponse["result"]> {
  const openai = getClient();
  const contextPrompt = buildEnrichmentPrompt(graph, chunks);

  const completion = await openai.chat.completions.parse({
    model: ENRICHMENT_MODEL,
    messages: [
      { role: "system", content: ENRICHMENT_SYSTEM_PROMPT },
      {
        role: "user",
        content: `${contextPrompt}\n\nReview this scene graph and add transitions to make it playable. List any terminal scenes that intentionally have no exits.`,
      },
    ],
    response_format: zodResponseFormat(
      EnrichmentResponseSchema,
      "enrichment",
    ),
  });

  const message = completion.choices[0]?.message;
  if (!message?.parsed) {
    throw new Error(
      "Connectivity enrichment failed: model returned no parsed content. " +
        (message?.refusal ? `Refusal: ${message.refusal}` : "Unknown error."),
    );
  }

  return message.parsed.result;
}

// ---------------------------------------------------------------------------
// Pass 2: Targeted Dead-End Repair
// ---------------------------------------------------------------------------

function buildRepairPrompt(
  graph: SceneGraph,
  deadEndIds: string[],
): string {
  const lines: string[] = [];
  lines.push("# Dead-End Repair");
  lines.push("");
  lines.push(
    "The following non-terminal scenes still have NO outgoing transitions. Add the minimum transitions needed.",
  );
  lines.push("");

  for (const deId of deadEndIds) {
    const scene = graph.scenes.find((s) => s.id === deId);
    if (!scene) continue;
    const idx = graph.scenes.indexOf(scene);
    lines.push(`## "${scene.title}" (position ${idx + 1})`);
    lines.push(`Description: ${scene.description.slice(0, 200)}`);
    lines.push("Neighboring scenes:");

    // Adjacent by document order
    if (idx > 0) {
      lines.push(`  - Previous: "${graph.scenes[idx - 1].title}"`);
    }
    if (idx < graph.scenes.length - 1) {
      lines.push(`  - Next: "${graph.scenes[idx + 1].title}"`);
    }

    // Connected via incoming transitions
    const incoming = graph.transitions.filter(
      (t) => t.toSceneId === deId,
    );
    for (const t of incoming) {
      const fromScene = graph.scenes.find(
        (s) => s.id === t.fromSceneId,
      );
      if (fromScene) {
        lines.push(`  - Incoming from: "${fromScene.title}"`);
      }
    }
    lines.push("");
  }

  lines.push("## All Scene Titles (for reference)");
  for (const s of graph.scenes) {
    lines.push(`- "${s.title}"`);
  }

  return lines.join("\n");
}

async function runDeadEndRepair(
  graph: SceneGraph,
  deadEndIds: string[],
): Promise<EnrichmentResponse["result"]> {
  const openai = getClient();
  const prompt = buildRepairPrompt(graph, deadEndIds);

  const completion = await openai.chat.completions.parse({
    model: ENRICHMENT_MODEL,
    messages: [
      {
        role: "system",
        content:
          "You are repairing a D&D campaign scene graph. Add the MINIMUM transitions needed so each listed dead-end scene has at least one outgoing transition. Scene titles must match EXACTLY. Do not add terminal scenes — those have already been identified.",
      },
      { role: "user", content: prompt },
    ],
    response_format: zodResponseFormat(
      EnrichmentResponseSchema,
      "enrichment",
    ),
  });

  const message = completion.choices[0]?.message;
  if (!message?.parsed) {
    throw new Error(
      "Dead-end repair failed: model returned no parsed content. " +
        (message?.refusal ? `Refusal: ${message.refusal}` : "Unknown error."),
    );
  }

  return message.parsed.result;
}

// ---------------------------------------------------------------------------
// Apply enrichment results to graph
// ---------------------------------------------------------------------------

function applyEnrichment(
  graph: SceneGraph,
  result: EnrichmentResponse["result"],
): SceneGraph {
  const titleToId = buildSceneTitleToId(graph);

  // Build set of existing transition keys for dedup
  const existingKeys = new Set(
    graph.transitions.map(
      (t) => `${t.fromSceneId}::${t.toSceneId}`,
    ),
  );

  const newTransitions: Transition[] = [];

  for (const added of result.addedTransitions) {
    const fromId = titleToId.get(added.fromScene.toLowerCase());
    const toId = titleToId.get(added.toScene.toLowerCase());

    if (!fromId || !toId) {
      console.warn(
        `[enrich] Skipping transition "${added.fromScene}" → "${added.toScene}": scene title not found`,
      );
      continue;
    }

    const key = `${fromId}::${toId}`;
    if (existingKeys.has(key)) {
      continue; // dedup
    }

    existingKeys.add(key);
    newTransitions.push({
      id: `trans-${slugify(added.fromScene)}-to-${slugify(added.toScene)}`,
      fromSceneId: fromId,
      toSceneId: toId,
      description: added.description,
      ...(added.condition != null && { condition: added.condition }),
      sourceChunkIndices: [],
    });
  }

  // Mark terminal scenes
  const updatedScenes = graph.scenes.map((s) => {
    const isTerminal = result.terminalSceneIds.some(
      (title) => title.toLowerCase() === s.title.toLowerCase(),
    );
    return isTerminal ? { ...s, isTerminal: true } : s;
  });

  if (newTransitions.length > 0) {
    console.log(
      `[enrich] Added ${newTransitions.length} new transition(s)`,
    );
  }
  if (result.notes) {
    console.log(`[enrich] LLM notes: ${result.notes}`);
  }

  return {
    ...graph,
    scenes: updatedScenes,
    transitions: [...graph.transitions, ...newTransitions],
  };
}

// ---------------------------------------------------------------------------
// Pass 3: Playability Validation
// ---------------------------------------------------------------------------

function validatePlayability(graph: SceneGraph): SceneGraph {
  const issues: string[] = [];

  // Check 1: every non-terminal scene has at least one outgoing transition
  const nonTerminalDeadEnds = graph.scenes.filter(
    (s) =>
      !s.isTerminal &&
      getOutgoingTransitions(graph, s.id).length === 0,
  );
  if (nonTerminalDeadEnds.length > 0) {
    issues.push(
      `Non-terminal scenes with no exits: ${nonTerminalDeadEnds.map((s) => `"${s.title}"`).join(", ")}`,
    );
  }

  // Check 2: starting scene has at least 2 outgoing transitions
  try {
    const startScene = findStartingScene(graph);
    const startOutgoing = getOutgoingTransitions(
      graph,
      startScene.id,
    ).length;
    if (startOutgoing < 2) {
      issues.push(
        `Starting scene "${startScene.title}" has only ${startOutgoing} outgoing transition(s), needs at least 2`,
      );
    }
  } catch {
    // findStartingScene throws on empty graphs — already handled by enrichGraph's empty check
  }

  // Check 3: warn if no terminal scenes identified
  const terminalScenes = graph.scenes.filter((s) => s.isTerminal);
  if (terminalScenes.length === 0) {
    console.warn(
      "[enrich] Warning: No terminal scenes identified — unusual for a campaign",
    );
  }

  if (issues.length > 0) {
    console.error(
      `[enrich] Graph is not play-ready: ${issues.join("; ")}. Try re-forging or check campaign content.`,
    );
    return { ...graph, playReady: false };
  }

  console.log("[enrich] Graph passed playability validation");
  return { ...graph, playReady: true };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Multi-pass enrichment pipeline for a scene graph:
 * 1. Connectivity enrichment — add missing transitions via LLM
 * 2. Dead-end repair — fix any remaining dead ends (conditional)
 * 3. Playability validation — verify the graph is navigable
 */
export async function enrichGraph(
  graph: SceneGraph,
  chunks: { text: string; chunkIndex: number }[],
): Promise<SceneGraph> {
  if (graph.scenes.length === 0) {
    console.warn("[enrich] Empty graph, skipping enrichment");
    return { ...graph, playReady: false };
  }

  // Pass 1: Connectivity Enrichment
  console.log("[enrich] Pass 1: Connectivity enrichment...");
  const enrichmentResult = await runConnectivityEnrichment(
    graph,
    chunks,
  );
  let enrichedGraph = applyEnrichment(graph, enrichmentResult);

  // Pass 2: Targeted Dead-End Repair (conditional)
  const remainingDeadEnds = getDeadEndScenes(enrichedGraph);
  if (remainingDeadEnds.length > 0) {
    console.log(
      `[enrich] Pass 2: Repairing ${remainingDeadEnds.length} remaining dead-end(s)...`,
    );
    const repairResult = await runDeadEndRepair(
      enrichedGraph,
      remainingDeadEnds,
    );
    enrichedGraph = applyEnrichment(enrichedGraph, repairResult);
  } else {
    console.log("[enrich] Pass 2: Skipped — no dead ends remaining");
  }

  // Pass 3: Playability Validation
  console.log("[enrich] Pass 3: Playability validation...");
  return validatePlayability(enrichedGraph);
}
