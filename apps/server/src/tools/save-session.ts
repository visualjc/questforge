import { z } from "zod";
import type { FastMCP } from "fastmcp";
import { loadSession, saveSession } from "../play/session-store.js";

export function registerSaveSessionTool(server: FastMCP) {
  server.addTool({
    name: "save_session",
    description:
      "Save/checkpoint a play session without processing a turn.",
    parameters: z.object({
      sessionId: z.string().describe("The session ID to save"),
    }),
    execute: async (args) => {
      try {
        const session = await loadSession(args.sessionId);
        if (!session) {
          return JSON.stringify({
            error: `Session "${args.sessionId}" not found.`,
          });
        }

        // Update the timestamp and re-save
        session.updatedAt = new Date().toISOString();
        await saveSession(session);

        return JSON.stringify({
          success: true,
          sessionId: session.sessionId,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: message });
      }
    },
  });
}
