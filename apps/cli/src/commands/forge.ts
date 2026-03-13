import { Command } from "commander";
import { createMcpClient, callTool } from "../client.js";

export function registerForgeCommand(program: Command): void {
  program
    .command("forge <campaign_id>")
    .description(
      "Generate a scene graph from an ingested campaign using LLM extraction",
    )
    .action(async (campaignId: string) => {
      const client = await createMcpClient();
      try {
        const info = (await callTool(client, "server_info")) as {
          name: string;
          version: string;
          transport: string;
        };
        console.log(`\n⚔ ${info.name} v${info.version} (${info.transport})\n`);

        console.log(`Forging scene graph for ${campaignId}...\n`);

        const result = (await callTool(client, "forge_campaign", {
          campaignId,
        })) as {
          campaignId?: string;
          scenesCount?: number;
          npcsCount?: number;
          itemsCount?: number;
          transitionsCount?: number;
          message?: string;
          error?: string;
        };

        if (result.error) {
          console.error(`Error: ${result.error}`);
          process.exit(1);
        }

        console.log(`✓ ${result.message}`);
        console.log(`  Scenes:      ${result.scenesCount}`);
        console.log(`  NPCs:        ${result.npcsCount}`);
        console.log(`  Items:       ${result.itemsCount}`);
        console.log(`  Transitions: ${result.transitionsCount}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${message}`);
        process.exit(1);
      } finally {
        await client.close();
      }
    });
}
