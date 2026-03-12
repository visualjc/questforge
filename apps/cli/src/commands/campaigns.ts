import { Command } from "commander";
import { createMcpClient, callTool } from "../client.js";

interface CampaignEntry {
  id: string;
  name: string;
  chunksCount: number;
  createdAt: string;
  sourceFile: string;
}

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
          campaigns: CampaignEntry[];
          message: string;
          error?: boolean;
        };

        if (data.error) {
          console.error(data.message);
          process.exit(1);
        }

        if (data.campaigns.length === 0) {
          console.log(data.message);
        } else {
          console.log(data.message);
          console.log();
          for (const c of data.campaigns) {
            const date = new Date(c.createdAt).toLocaleDateString();
            console.log(`  ${c.name}`);
            console.log(`    ID: ${c.id}  |  Chunks: ${c.chunksCount}  |  Source: ${c.sourceFile}  |  Added: ${date}`);
            console.log();
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${message}`);
        process.exit(1);
      } finally {
        await client.close();
      }
    });
}
