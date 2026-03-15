import { FastMCP } from "fastmcp";
import { registerServerInfoTool } from "./tools/server-info.js";
import { registerListCampaignsTool } from "./tools/list-campaigns.js";
import { registerIngestCampaignTool } from "./tools/ingest-campaign.js";
import { registerForgeCampaignTool } from "./tools/forge-campaign.js";
import { registerGetGraphTool } from "./tools/get-graph.js";
import { registerStartSessionTool } from "./tools/start-session.js";
import { registerPlayTurnTool } from "./tools/play-turn.js";
import { registerResumeSessionTool } from "./tools/resume-session.js";
import { registerSaveSessionTool } from "./tools/save-session.js";

export function createServer() {
  const server = new FastMCP({
    name: "QuestForge",
    version: "0.1.0",
  });

  registerServerInfoTool(server);
  registerListCampaignsTool(server);
  registerIngestCampaignTool(server);
  registerForgeCampaignTool(server);
  registerGetGraphTool(server);
  registerStartSessionTool(server);
  registerPlayTurnTool(server);
  registerResumeSessionTool(server);
  registerSaveSessionTool(server);

  return server;
}
