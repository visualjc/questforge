#!/usr/bin/env bun
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";

const SERVER_ENTRY = path.resolve(
  import.meta.dirname,
  "../../server/src/index.ts",
);

export async function createMcpClient(): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.env.QUESTFORGE_BUN_BIN || process.execPath || "bun",
    args: ["run", SERVER_ENTRY],
    stderr: "ignore",
    env: Object.fromEntries(
      Object.entries(process.env).filter((e): e is [string, string] => e[1] != null),
    ),
  });

  const client = new Client({ name: "questforge-cli", version: "0.0.1" });
  await client.connect(transport);
  return client;
}

export async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content as Array<{ type: string; text?: string }>;
  const json = text.find((c) => c.type === "text")?.text;
  return json ? JSON.parse(json) : result.content;
}
