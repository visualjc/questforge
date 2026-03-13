import { Command } from "commander";
import { createMcpClient, callTool } from "../client.js";
import path from "node:path";

export function registerIngestCommand(program: Command): void {
  program
    .command("ingest <pdf-path>")
    .description("Ingest a campaign PDF into the vector store")
    .option("-n, --name <campaign-name>", "Campaign name (defaults to filename)")
    .action(async (pdfPath: string, opts: { name?: string }) => {
      const resolvedPath = path.resolve(pdfPath);

      const client = await createMcpClient();
      try {
        // Print branded header
        const info = (await callTool(client, "server_info")) as {
          name: string;
          version: string;
          transport: string;
        };
        console.log(`\n⚔ ${info.name} v${info.version} (${info.transport})\n`);

        console.log(`Ingesting: ${resolvedPath}`);
        if (opts.name) {
          console.log(`Campaign name: ${opts.name}`);
        }
        console.log();

        const args: Record<string, unknown> = { filePath: resolvedPath };
        if (opts.name) {
          args.name = opts.name;
        }

        const result = (await callTool(client, "ingest_campaign", args)) as {
          campaignId?: string;
          collectionName?: string;
          chunksCount?: number;
          message?: string;
          error?: string;
        };

        if (result.error) {
          console.error(`Error: ${result.error}`);
          process.exit(1);
        }

        console.log(`✓ ${result.message}`);
        console.log(`  Campaign ID:  ${result.campaignId}`);
        console.log(`  Collection:   ${result.collectionName}`);
        console.log(`  Chunks:       ${result.chunksCount}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${message}`);
        process.exit(1);
      } finally {
        await client.close();
      }
    });
}
