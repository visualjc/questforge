import { Command } from "commander";
import * as readline from "node:readline";
import { createMcpClient, callTool } from "../client.js";

function prompt(
  rl: readline.Interface,
  query: string,
): Promise<string> {
  return new Promise((resolve) => rl.question(query, resolve));
}

interface SceneInfo {
  sessionId: string;
  scene: {
    title: string;
    description: string;
    sceneType: string;
    exits: Array<{ sceneId: string; name: string; description: string }>;
  };
  error?: string;
}

interface TurnResult {
  response: string;
  shouldEnd: boolean;
  session: {
    sessionId: string;
    currentSceneId: string;
    visitedCount: number;
    inventoryCount: number;
  };
  error?: string;
}

function displayScene(info: SceneInfo): void {
  console.log(`\n=== ${info.scene.title} ===`);
  console.log(`[${info.scene.sceneType}]`);
  console.log(info.scene.description);
  if (info.scene.exits.length > 0) {
    console.log("\nExits:");
    for (const exit of info.scene.exits) {
      console.log(`  → ${exit.name} (${exit.description})`);
    }
  }
}

function displayHelp(): void {
  console.log("\nCommands:");
  console.log("  /help       — Show this help message");
  console.log("  /look       — Look around the current scene");
  console.log("  /quit       — Save session and exit");
  console.log("  /exit       — Save session and exit");
  console.log("");
  console.log("Or type anything to interact with the world.");
}

export function registerPlayCommand(program: Command): void {
  program
    .command("play <campaign_id>")
    .description("Play through a campaign interactively")
    .option("--resume <session_id>", "Resume an existing session")
    .action(async (campaignId: string, opts: { resume?: string }) => {
      const client = await createMcpClient();
      try {
        const info = (await callTool(client, "server_info")) as {
          name: string;
          version: string;
        };
        console.log(`\n⚔ ${info.name} v${info.version}\n`);

        let sessionId: string;

        if (opts.resume) {
          const result = (await callTool(
            client,
            "resume_play_session",
            { sessionId: opts.resume },
          )) as SceneInfo;

          if (result.error) {
            console.error(`Error: ${result.error}`);
            process.exit(1);
          }

          sessionId = result.sessionId;
          console.log(`Resuming session ${sessionId}...`);
          displayScene(result);
        } else {
          const result = (await callTool(
            client,
            "start_play_session",
            { campaignId },
          )) as SceneInfo;

          if (result.error) {
            console.error(`Error: ${result.error}`);
            process.exit(1);
          }

          sessionId = result.sessionId;
          console.log(`New session: ${sessionId}`);
          displayScene(result);
        }

        console.log('\nType /help for commands.\n');

        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        try {
          while (true) {
            const input = await prompt(rl, "> ");
            const trimmed = input.trim();

            if (!trimmed) continue;

            if (trimmed === "/help") {
              displayHelp();
              continue;
            }

            if (trimmed === "/quit" || trimmed === "/exit") {
              const result = (await callTool(client, "play_turn", {
                sessionId,
                message: "quit",
              })) as TurnResult;

              if (result.response) {
                console.log(`\n${result.response}`);
              }

              console.log(
                `\nSession saved: ${sessionId}. Resume with: questforge play ${campaignId} --resume ${sessionId}`,
              );
              break;
            }

            const message = trimmed === "/look" ? "look around" : trimmed;

            const result = (await callTool(client, "play_turn", {
              sessionId,
              message,
            })) as TurnResult;

            if (result.error) {
              console.error(`Error: ${result.error}`);
              continue;
            }

            console.log(`\n${result.response}\n`);

            if (result.shouldEnd) {
              console.log(
                `\nSession saved: ${sessionId}. Resume with: questforge play ${campaignId} --resume ${sessionId}`,
              );
              break;
            }
          }
        } finally {
          rl.close();
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
