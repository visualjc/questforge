#!/usr/bin/env bun
import { Command } from "commander";
import { registerCampaignsCommand } from "./commands/campaigns.js";
import { registerIngestCommand } from "./commands/ingest.js";
import { registerForgeCommand } from "./commands/forge.js";
import { registerGraphCommand } from "./commands/graph.js";
import { registerStubCommands } from "./commands/stubs.js";

const program = new Command()
  .name("questforge")
  .description("QuestForge — turn tabletop campaign PDFs into playable interactive fiction")
  .version("0.0.1");

registerCampaignsCommand(program);
registerIngestCommand(program);
registerForgeCommand(program);
registerGraphCommand(program);
registerStubCommands(program);

await program.parseAsync();

// Show help if no command was given
if (program.args.length === 0 && !process.argv.slice(2).length) {
  program.help();
}
