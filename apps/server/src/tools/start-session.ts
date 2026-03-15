import { z } from "zod";
import type { FastMCP } from "fastmcp";
import type { PlaySession } from "@questforge/shared";
import { loadGraph } from "../forge/store-graph.js";
import { findStartingScene } from "../play/engine.js";
import {
  generateSessionId,
  saveSession,
} from "../play/session-store.js";

export function registerStartSessionTool(server: FastMCP) {
  server.addTool({
    name: "start_play_session",
    description:
      "Start a new interactive play session for a forged campaign. Returns the starting scene info and a session ID.",
    parameters: z.object({
      campaignId: z
        .string()
        .describe("The campaign ID to start a play session for"),
    }),
    execute: async (args) => {
      try {
        const graph = await loadGraph(args.campaignId);
        if (!graph) {
          return JSON.stringify({
            error:
              "No scene graph found. Run 'forge' first.",
          });
        }

        if (graph.playReady !== true) {
          return JSON.stringify({
            error: "This campaign's scene graph is not play-ready. Try re-forging the campaign with: questforge forge " + args.campaignId,
          });
        }

        const startScene = findStartingScene(graph);
        const sessionId = generateSessionId(args.campaignId);

        const session: PlaySession = {
          sessionId,
          campaignId: args.campaignId,
          currentSceneId: startScene.id,
          visitedSceneIds: [startScene.id],
          inventory: [],
          flags: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        await saveSession(session);

        const transitions = graph.transitions.filter(
          (t) => t.fromSceneId === startScene.id,
        );
        const exits = transitions.map((t) => {
          const target = graph.scenes.find((s) => s.id === t.toSceneId);
          return {
            sceneId: t.toSceneId,
            name: target?.title ?? t.toSceneId,
            description: t.description,
          };
        });

        return JSON.stringify({
          sessionId,
          scene: {
            title: startScene.title,
            description: startScene.description,
            sceneType: startScene.sceneType,
            isTerminal: startScene.isTerminal ?? false,
            exits,
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: message });
      }
    },
  });
}
