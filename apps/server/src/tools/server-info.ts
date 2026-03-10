import { z } from "zod";
import type { FastMCP } from "fastmcp";

const VERSION = "0.1.0";

export function registerServerInfoTool(server: FastMCP) {
  server.addTool({
    name: "server_info",
    description: "Returns QuestForge server metadata including name, version, and transport type",
    parameters: z.object({}),
    execute: async () => {
      return JSON.stringify({
        name: "QuestForge",
        version: VERSION,
        transport: "stdio",
      });
    },
  });
}
