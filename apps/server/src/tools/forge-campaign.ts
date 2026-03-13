import { z } from "zod";
import type { FastMCP } from "fastmcp";
import { forgeCampaign } from "../forge/pipeline.js";

export function registerForgeCampaignTool(server: FastMCP) {
  server.addTool({
    name: "forge_campaign",
    description:
      "Generate a scene graph from an ingested campaign using LLM extraction. Extracts scenes, NPCs, items, and transitions.",
    parameters: z.object({
      campaignId: z.string().describe("The campaign ID to forge a scene graph for"),
    }),
    execute: async (args) => {
      if (!process.env.OPENAI_API_KEY) {
        return JSON.stringify({
          error:
            "OPENAI_API_KEY environment variable is not set. Required for LLM extraction.",
        });
      }

      try {
        const graph = await forgeCampaign(args.campaignId);
        return JSON.stringify({
          campaignId: graph.campaignId,
          scenesCount: graph.scenes.length,
          npcsCount: graph.npcs.length,
          itemsCount: graph.items.length,
          transitionsCount: graph.transitions.length,
          message: `Successfully forged scene graph for "${graph.campaignName}" (${graph.scenes.length} scenes, ${graph.npcs.length} NPCs, ${graph.items.length} items, ${graph.transitions.length} transitions)`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: message });
      }
    },
  });
}
