import { Command } from "commander";
import { createMcpClient, callTool } from "../client.js";

export function registerCampaignsCommand(program: Command): void {
  const campaigns = program
    .command("campaigns")
    .description("Manage campaigns");

  campaigns
    .command("list")
    .description("List all available campaigns")
    .action(async () => {
      const client = await createMcpClient();
      try {
        // Print branded header from server_info
        const info = (await callTool(client, "server_info")) as {
          name: string;
          version: string;
          transport: string;
        };
        console.log(`\n⚔ ${info.name} v${info.version} (${info.transport})\n`);

        // List campaigns
        const data = (await callTool(client, "list_campaigns")) as {
          campaigns: unknown[];
          message: string;
        };
        if (data.campaigns.length === 0) {
          console.log(data.message);
        } else {
          for (const c of data.campaigns) {
            console.log(c);
          }
        }
      } finally {
        await client.close();
      }
    });
}
