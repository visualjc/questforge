import { Command } from "commander";
import { createMcpClient, callTool } from "../client.js";
import type { SceneGraph } from "@questforge/shared";

export function registerGraphCommand(program: Command): void {
  program
    .command("graph <campaign_id>")
    .description("Inspect the scene graph for a campaign")
    .action(async (campaignId: string) => {
      const client = await createMcpClient();
      try {
        const info = (await callTool(client, "server_info")) as {
          name: string;
          version: string;
          transport: string;
        };
        console.log(`\n⚔ ${info.name} v${info.version} (${info.transport})\n`);

        const result = (await callTool(client, "get_scene_graph", {
          campaignId,
        })) as SceneGraph & { error?: string };

        if (result.error) {
          console.error(`Error: ${result.error}`);
          process.exit(1);
        }

        console.log(
          `Scene Graph: ${result.campaignName} (${result.campaignId})`,
        );
        console.log(
          `Model: ${result.model} | Created: ${result.createdAt} | Chunks: ${result.sourceChunkCount}`,
        );
        if (result.playReady !== undefined) {
          console.log(`playReady: ${result.playReady}`);
        }

        // Scenes
        console.log(`\n── Scenes (${result.scenes.length}) ──`);
        for (const scene of result.scenes) {
          const terminalTag = scene.isTerminal ? " [TERMINAL]" : "";
          console.log(`  [${scene.sceneType}] ${scene.title}${terminalTag}`);
          console.log(`    ${scene.description}`);
          console.log(`    (chunks: ${scene.sourceChunkIndices.join(", ")})`);
        }

        // Transitions
        if (result.transitions.length > 0) {
          console.log(`\n── Transitions (${result.transitions.length}) ──`);
          for (const t of result.transitions) {
            const from =
              result.scenes.find((s) => s.id === t.fromSceneId)?.title ??
              t.fromSceneId;
            const to =
              result.scenes.find((s) => s.id === t.toSceneId)?.title ??
              t.toSceneId;
            console.log(`  ${from} → ${to}`);
            console.log(`    ${t.description}`);
            if (t.condition) {
              console.log(`    Condition: ${t.condition}`);
            }
            console.log(`    (chunks: ${t.sourceChunkIndices.join(", ")})`);
          }
        }

        // NPCs
        if (result.npcs.length > 0) {
          console.log(`\n── NPCs (${result.npcs.length}) ──`);
          for (const npc of result.npcs) {
            console.log(`  ${npc.name} (${npc.role})`);
            console.log(`    ${npc.description}`);
            console.log(`    (chunks: ${npc.sourceChunkIndices.join(", ")})`);
          }
        }

        // Items
        if (result.items.length > 0) {
          console.log(`\n── Items (${result.items.length}) ──`);
          for (const item of result.items) {
            console.log(`  ${item.name}`);
            console.log(`    ${item.description}`);
            if (
              item.properties &&
              typeof item.properties === "object" &&
              "tags" in item.properties
            ) {
              const tags = item.properties.tags as string[];
              console.log(`    Properties: ${tags.join(", ")}`);
            }
            console.log(`    (chunks: ${item.sourceChunkIndices.join(", ")})`);
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${message}`);
        process.exit(1);
      } finally {
        await client.close();
      }
    });
}
