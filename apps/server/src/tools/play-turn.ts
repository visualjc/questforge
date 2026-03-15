import { z } from "zod";
import type { FastMCP } from "fastmcp";
import { loadGraph } from "../forge/store-graph.js";
import { processTurn } from "../play/engine.js";
import { loadSession, saveSession } from "../play/session-store.js";

export function registerPlayTurnTool(server: FastMCP) {
  server.addTool({
    name: "play_turn",
    description:
      "Process a player's turn in an active play session. Sends the player's message to the engine and returns the response.",
    parameters: z.object({
      sessionId: z.string().describe("The active session ID"),
      message: z.string().describe("The player's message or action"),
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

        const result = await processTurn(args.message, session, graph);
        await saveSession(result.updatedSession);

        return JSON.stringify({
          response: result.response,
          shouldEnd: result.shouldEnd,
          session: {
            sessionId: result.updatedSession.sessionId,
            currentSceneId: result.updatedSession.currentSceneId,
            visitedCount: result.updatedSession.visitedSceneIds.length,
            inventoryCount: result.updatedSession.inventory.length,
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: message });
      }
    },
  });
}
