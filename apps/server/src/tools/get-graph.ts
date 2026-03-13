import { z } from "zod";
import type { FastMCP } from "fastmcp";
import { loadGraph } from "../forge/store-graph.js";

export function registerGetGraphTool(server: FastMCP) {
  server.addTool({
    name: "get_scene_graph",
    description:
      "Retrieve the scene graph for a campaign. Returns the full graph with scenes, NPCs, items, and transitions.",
    parameters: z.object({
      campaignId: z.string().describe("The campaign ID to retrieve the scene graph for"),
    }),
    execute: async (args) => {
      try {
        const graph = await loadGraph(args.campaignId);
        if (!graph) {
          return JSON.stringify({
            error: `No scene graph found for campaign "${args.campaignId}". Run 'forge' first.`,
          });
        }
        return JSON.stringify(graph);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: message });
      }
    },
  });
}
