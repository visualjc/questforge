import { FastMCP } from "fastmcp";
import { registerServerInfoTool } from "./tools/server-info.js";
import { registerListCampaignsTool } from "./tools/list-campaigns.js";

export function createServer() {
  const server = new FastMCP({
    name: "QuestForge",
    version: "0.1.0",
  });

  registerServerInfoTool(server);
  registerListCampaignsTool(server);

  return server;
}
