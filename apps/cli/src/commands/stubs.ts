import { Command } from "commander";

interface StubDef {
  name: string;
  args: string;
  description: string;
  stage: number;
}

const stubs: StubDef[] = [
  {
    name: "play",
    args: "<campaign_id>",
    description: "Play through a campaign interactively",
    stage: 4,
  },
  {
    name: "inventory",
    args: "<campaign_id>",
    description: "View current inventory and flags for a campaign",
    stage: 4,
  },
  {
    name: "history",
    args: "<campaign_id>",
    description: "View session history for a campaign",
    stage: 4,
  },
];

export function registerStubCommands(program: Command): void {
  for (const stub of stubs) {
    program
      .command(`${stub.name} ${stub.args}`)
      .description(stub.description)
      .action(() => {
        console.log(
          `⚔ ${stub.name} is not yet implemented — coming in Stage ${stub.stage}.`,
        );
      });
  }

  // "sessions list" is a subcommand group
  const sessions = program
    .command("sessions")
    .description("Manage play sessions");

  sessions
    .command("list")
    .description("List all play sessions")
    .action(() => {
      console.log(
        "⚔ sessions list is not yet implemented — coming in Stage 4.",
      );
    });
}
