import { z } from "zod";
import type { FastMCP } from "fastmcp";
import { loadGraph } from "../forge/store-graph.js";
import { loadSession } from "../play/session-store.js";

export function registerResumeSessionTool(server: FastMCP) {
  server.addTool({
    name: "resume_play_session",
    description:
      "Resume an existing play session. Returns the current scene info so the player sees where they left off.",
    parameters: z.object({
      sessionId: z.string().describe("The session ID to resume"),
    }),
    execute: async (args) => {
      try {
        const session = await loadSession(args.sessionId);
        if (!session) {
          return JSON.stringify({
            error: `Session "${args.sessionId}" not found.`,
          });
        }

        const graph = await loadGraph(session.campaignId);
        if (!graph) {
          return JSON.stringify({
            error: `Scene graph for campaign "${session.campaignId}" not found.`,
          });
        }

        if (graph.playReady === false) {
          return JSON.stringify({
            error: "This campaign's scene graph is not play-ready. Try re-forging the campaign with: questforge forge " + session.campaignId,
          });
        }

        const currentScene = graph.scenes.find(
          (s) => s.id === session.currentSceneId,
        );
        if (!currentScene) {
          return JSON.stringify({
            error: `Your session references scene "${session.currentSceneId}" which no longer exists in the current graph. The campaign may have been re-forged. Start a new session instead.`,
          });
        }

        const transitions = graph.transitions.filter(
          (t) => t.fromSceneId === currentScene.id,
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
          sessionId: session.sessionId,
          campaignId: session.campaignId,
          scene: {
            title: currentScene.title,
            description: currentScene.description,
            sceneType: currentScene.sceneType,
            isTerminal: currentScene.isTerminal ?? false,
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
