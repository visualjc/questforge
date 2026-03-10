#!/usr/bin/env bun
import { Command } from "commander";
import { registerCampaignsCommand } from "./commands/campaigns.js";
import { registerStubCommands } from "./commands/stubs.js";

const program = new Command()
  .name("questforge")
  .description("QuestForge — turn tabletop campaign PDFs into playable interactive fiction")
  .version("0.0.1");

registerCampaignsCommand(program);
registerStubCommands(program);

program.parse();

// Show help if no command was given
if (program.args.length === 0 && !process.argv.slice(2).length) {
  program.help();
}
