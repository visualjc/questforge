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
- The starting scene (first scene in the list, typically with no incoming transitions) should have at least 3 outgoing transitions.
- CRITICAL: The starting scene MUST have at least one forward-moving transition that leads DEEPER into the campaign (toward the campaign's interior/adventure areas), not just backtrack options. Look at the starting scene's description — it usually mentions a path forward, an entrance, or a way deeper into the adventure. Create a transition for that forward path.
- Add bidirectional connections where logical (e.g. if you can go from Village to Causeway, you should be able to go back).
- Ensure ALL scenes are reachable from the starting scene — every non-terminal scene must have at least one incoming transition from a reachable scene.
- Identify terminal/climax scenes (boss encounters, final rooms) that should intentionally have zero exits — list them in terminalSceneIds.
- Terminal/climax scenes MUST have at least one INCOMING transition from a nearby reachable scene so the player can actually reach the campaign's ending. If a boss encounter or final scene exists, ensure there is a path TO it (e.g. Throne Room → Boss Encounter).
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
  // Compute reachability to identify unreachable scenes
  let reachableSet: Set<string> | null = null;
  try {
    const start = findStartingScene(graph);
    reachableSet = new Set<string>();
    const queue = [start.id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (reachableSet.has(current)) continue;
      reachableSet.add(current);
      for (const t of graph.transitions.filter(tr => tr.fromSceneId === current)) {
        if (!reachableSet.has(t.toSceneId)) queue.push(t.toSceneId);
      }
    }
  } catch {
    // empty graph
  }

  // Collect unreachable non-terminal scenes not already in deadEndIds
  const unreachableIds: string[] = [];
  if (reachableSet) {
    for (const s of graph.scenes) {
      if (!s.isTerminal && !reachableSet.has(s.id) && !deadEndIds.includes(s.id)) {
        unreachableIds.push(s.id);
      }
    }
  }

  const allRepairIds = [...deadEndIds, ...unreachableIds];

  // Identify starting scene for special guidance
  let startSceneId: string | null = null;
  try {
    startSceneId = findStartingScene(graph).id;
  } catch {
    // empty graph
  }

  const lines: string[] = [];
  lines.push("# Dead-End & Unreachable Scene Repair");
  lines.push("");
  lines.push(
    "The following scenes need repair. For each one, either add the minimum transitions needed OR mark it as terminal (in terminalSceneIds) if it is clearly a boss encounter or campaign climax.",
  );
  lines.push("");

  for (const deId of allRepairIds) {
    const scene = graph.scenes.find((s) => s.id === deId);
    if (!scene) continue;
    const idx = graph.scenes.indexOf(scene);
    const isUnreachable = unreachableIds.includes(deId) || (scene.isTerminal && reachableSet != null && !reachableSet.has(deId));
    const isDeadEnd = deadEndIds.includes(deId);
    const isStartScene = deId === startSceneId;
    const isTerminal = scene.isTerminal === true;
    const tags: string[] = [];
    if (isTerminal) tags.push("TERMINAL");
    if (isDeadEnd && !isTerminal) tags.push("dead-end");
    if (isUnreachable) tags.push("UNREACHABLE");
    if (isStartScene) tags.push("STARTING-SCENE");
    lines.push(`## "${scene.title}" (position ${idx + 1}, type: ${scene.sceneType}, issues: ${tags.join(", ")})`);
    lines.push(`Description: ${scene.description.slice(0, 200)}`);
    if (isTerminal && isUnreachable) {
      lines.push("⚠ This is a TERMINAL scene (campaign climax/boss encounter). It needs at least one INCOMING transition from a nearby reachable scene so the player can reach the campaign's ending. Do NOT add outgoing transitions from this scene.");
    } else if (isUnreachable) {
      lines.push("⚠ This scene has no incoming transitions from any reachable scene. Add a transition FROM a nearby reachable scene TO this scene so players can reach it.");
    }
    if (isStartScene) {
      lines.push("⚠ This is the campaign's STARTING SCENE. It needs at least 3 outgoing transitions, and at least one MUST lead FORWARD into the adventure (toward scenes deeper in the campaign — look at the description for mentions of entrances, paths forward, or ways deeper into the adventure). Do not just add backtrack/retreat options.");
    }
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
          "You are repairing a D&D campaign scene graph. For each listed scene, do ONE of the following:\n" +
          "1. Add the MINIMUM transitions needed so the scene has at least one outgoing transition, OR\n" +
          "2. If the scene is clearly a boss encounter, final confrontation, or campaign climax (e.g. a throne room with the main antagonist), mark it as terminal by adding its EXACT title to terminalSceneIds instead of adding transitions.\n" +
          "For UNREACHABLE scenes: add a transition FROM a nearby reachable scene TO this scene.\n" +
          "For TERMINAL UNREACHABLE scenes: add a transition FROM a nearby reachable scene TO this scene (incoming only). Do NOT add outgoing transitions from terminal scenes.\n" +
          "For STARTING-SCENE: ensure at least 3 outgoing transitions, with at least one leading FORWARD deeper into the campaign.\n" +
          "Scene titles must match EXACTLY.",
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

  // Check 4: all non-terminal scenes are reachable from starting scene
  try {
    const start = findStartingScene(graph);
    const reachable = new Set<string>();
    const queue = [start.id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (reachable.has(current)) continue;
      reachable.add(current);
      for (const t of graph.transitions.filter(tr => tr.fromSceneId === current)) {
        if (!reachable.has(t.toSceneId)) queue.push(t.toSceneId);
      }
    }
    const unreachable = graph.scenes.filter(s => !s.isTerminal && !reachable.has(s.id));
    if (unreachable.length > 0) {
      issues.push(
        `Unreachable non-terminal scenes: ${unreachable.map(s => s.title).join(", ")}`
      );
    }

    // Check 6: at least one terminal scene must be reachable from starting scene
    const reachableTerminal = terminalScenes.filter(s => reachable.has(s.id));
    if (terminalScenes.length > 0 && reachableTerminal.length === 0) {
      issues.push(
        `No terminal scenes are reachable from the starting scene. Unreachable terminal scenes: ${terminalScenes.map(s => s.title).join(", ")}`
      );
    }
  } catch {
    // findStartingScene may throw on empty graphs
  }

  // Check 5: terminal scenes should have zero outgoing transitions
  for (const ts of terminalScenes) {
    const outgoing = getOutgoingTransitions(graph, ts.id);
    if (outgoing.length > 0) {
      issues.push(
        `Terminal scene "${ts.title}" still has ${outgoing.length} outgoing transition(s) — should have zero`
      );
    }
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
  // Also include starting scene if it has fewer than 3 exits
  const remainingDeadEnds = getDeadEndScenes(enrichedGraph);
  const startScene = findStartingScene(enrichedGraph);
  const startExitCount = getOutgoingTransitions(enrichedGraph, startScene.id).length;
  if (startExitCount < 3 && !remainingDeadEnds.includes(startScene.id)) {
    remainingDeadEnds.push(startScene.id);
  }
  if (remainingDeadEnds.length > 0) {
    console.log(
      `[enrich] Pass 2: Repairing ${remainingDeadEnds.length} remaining issue(s)...`,
    );
    const repairResult = await runDeadEndRepair(
      enrichedGraph,
      remainingDeadEnds,
    );
    enrichedGraph = applyEnrichment(enrichedGraph, repairResult);
  } else {
    console.log("[enrich] Pass 2: Skipped — no dead ends remaining");
  }

  // Strip outgoing transitions from terminal scenes
  const terminalIds = new Set(
    enrichedGraph.scenes.filter(s => s.isTerminal).map(s => s.id)
  );
  if (terminalIds.size > 0) {
    const before = enrichedGraph.transitions.length;
    enrichedGraph.transitions = enrichedGraph.transitions.filter(
      t => !terminalIds.has(t.fromSceneId)
    );
    const removed = before - enrichedGraph.transitions.length;
    if (removed > 0) {
      console.log(`[enrich] Stripped ${removed} outgoing transition(s) from terminal scene(s)`);
    }
  }

  // Pass 2b: Repair unreachable terminal scenes (conditional)
  // After terminal stripping, check if any terminal scenes are unreachable
  if (terminalIds.size > 0) {
    const reachable = new Set<string>();
    const queue = [findStartingScene(enrichedGraph).id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (reachable.has(current)) continue;
      reachable.add(current);
      for (const t of enrichedGraph.transitions.filter(tr => tr.fromSceneId === current)) {
        if (!reachable.has(t.toSceneId)) queue.push(t.toSceneId);
      }
    }
    const unreachableTerminals = enrichedGraph.scenes
      .filter(s => s.isTerminal && !reachable.has(s.id))
      .map(s => s.id);
    if (unreachableTerminals.length > 0) {
      console.log(
        `[enrich] Pass 2b: Repairing ${unreachableTerminals.length} unreachable terminal scene(s)...`,
      );
      const termRepairResult = await runDeadEndRepair(
        enrichedGraph,
        unreachableTerminals,
      );
      enrichedGraph = applyEnrichment(enrichedGraph, termRepairResult);
      // Re-strip any outgoing transitions accidentally added to terminal scenes
      enrichedGraph.transitions = enrichedGraph.transitions.filter(
        t => !terminalIds.has(t.fromSceneId)
      );
    }
  }

  // Pass 3: Playability Validation
  console.log("[enrich] Pass 3: Playability validation...");
  return validatePlayability(enrichedGraph);
}
