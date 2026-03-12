import { z } from "zod";
import type { FastMCP } from "fastmcp";

export function registerListCampaignsTool(server: FastMCP) {
  server.addTool({
    name: "list_campaigns",
    description: "Lists all available campaigns",
    parameters: z.object({}),
    execute: async () => {
      return JSON.stringify({
        campaigns: [],
        message: "No campaigns found",
      });
    },
  });
}
