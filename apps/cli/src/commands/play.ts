import { Command } from "commander";
import * as readline from "node:readline";
import { createMcpClient, callTool } from "../client.js";

function prompt(
  rl: readline.Interface,
  query: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    rl.question(query, resolve);
    rl.once("close", () => reject(new Error("EOF")));
  });
}

interface SceneInfo {
  sessionId: string;
  campaignId?: string;
  scene: {
    title: string;
    description: string;
    sceneType: string;
    isTerminal?: boolean;
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

  if (info.scene.isTerminal && info.scene.exits.length === 0) {
    console.log("");
    console.log(`🎉 Congratulations! You have completed the campaign!`);
    console.log("Your adventure ends here. Type /quit to save your final progress.");
  } else if (info.scene.exits.length > 0) {
    console.log("\nWhat do you do?");
    info.scene.exits.forEach((exit, i) => {
      console.log(`  ${i + 1}. ${exit.description} → ${exit.name}`);
    });
    console.log("\nType a number to choose, or type anything else to interact.");
  } else {
    console.log("\n⚠ This scene has no available exits. This may indicate a graph quality issue.");
    console.log("Type anything to interact, or /quit to save and exit.");
  }
}

function displayHelp(): void {
  console.log("\nCommands:");
  console.log("  1, 2, 3...  — Choose a numbered option");
  console.log("  /look       — Look around the current scene");
  console.log("  /help       — Show this help message");
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
        let actualCampaignId = campaignId;

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
          actualCampaignId = result.campaignId ?? campaignId;
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
            let input: string;
            try {
              input = await prompt(rl, "> ");
            } catch {
              // EOF — stdin closed (piped input exhausted)
              const saveResult = (await callTool(client, "save_session", {
                sessionId,
              })) as { success?: boolean; error?: string };
              if (saveResult.error) {
                console.error(`\nError saving session: ${saveResult.error}`);
              } else {
                console.log("\nSession ended. Your progress has been saved.");
                console.log(
                  `\nResume with: questforge play ${actualCampaignId} --resume ${sessionId}`,
                );
              }
              break;
            }
            const trimmed = input.trim();

            if (!trimmed) continue;

            if (trimmed === "/help") {
              displayHelp();
              continue;
            }

            if (trimmed === "/quit" || trimmed === "/exit") {
              const saveResult = (await callTool(client, "save_session", {
                sessionId,
              })) as { success?: boolean; error?: string };

              if (saveResult.error) {
                console.error(`\nError saving session: ${saveResult.error}`);
                console.error("Your progress may not have been saved.");
                break;
              }

              console.log("\nFarewell, adventurer! Your progress has been saved.");
              console.log(
                `\nSession saved: ${sessionId}. Resume with: questforge play ${actualCampaignId} --resume ${sessionId}`,
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
                `\nSession saved: ${sessionId}. Resume with: questforge play ${actualCampaignId} --resume ${sessionId}`,
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
