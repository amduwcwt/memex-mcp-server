#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { LocalStorage } from "./storage/local.js";
import { LifecycleManager } from "./lifecycle.js";
import { registerTools } from "./tools.js";

const DB_PATH = process.env.MEMEX_DB_PATH || `${process.env.HOME}/.claude/memex.db`;

async function main(): Promise<void> {
  const storage = new LocalStorage(DB_PATH);
  const lifecycle = new LifecycleManager(storage);
  await lifecycle.start();

  const server = new McpServer({
    name: "memex",
    version: "1.1.1",
  });

  registerTools(server, storage);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stderr.write(`[memex] Server started. DB: ${DB_PATH}\n`);

  const shutdown = () => {
    lifecycle.stop();
    storage.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  process.stderr.write(`[memex] Fatal error: ${err}\n`);
  process.exit(1);
});
