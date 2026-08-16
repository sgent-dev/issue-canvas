#!/usr/bin/env node
/**
 * Issue Canvas MCP server (stdio)
 *
 * ツール定義は src/core/tools.ts(REST API と共有)。
 * 判定(ダブり/モレ)は呼び出し側モデルが行う: mece_material → 判定 → mece_report。
 * サーバー自身は LLM API を呼ばない。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { JsonFileStore } from "../core/store.js";
import { createStoreFromEnv } from "../core/store-select.js";
import { TOOLS } from "../core/tools.js";

const { store, describe } = createStoreFromEnv();

const server = new McpServer({ name: "issue-canvas", version: "0.1.0" });

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const ok = (data: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
const err = (e: unknown): ToolResult => ({
  content: [{ type: "text", text: `error: ${e instanceof Error ? e.message : String(e)}` }],
  isError: true,
});

const boardId = z.string().describe("ボードID (board_list で取得)");

for (const t of TOOLS) {
  if (t.scope === "store") {
    server.registerTool(t.name, { title: t.title, description: t.description, inputSchema: t.schema }, async (args) => {
      try {
        return ok(await t.run(store, args));
      } catch (e) {
        return err(e);
      }
    });
  } else {
    server.registerTool(
      t.name,
      { title: t.title, description: t.description, inputSchema: { boardId, ...t.schema } },
      async ({ boardId: id, ...args }) => {
        try {
          const b = await store.load(id as string);
          const result = await t.run(b, args);
          if (t.scope === "board") await store.save(b);
          return ok(result);
        } catch (e) {
          return err(e);
        }
      },
    );
  }
}

async function main(): Promise<void> {
  if (store instanceof JsonFileStore) await store.ensureDir();
  await server.connect(new StdioServerTransport());
  console.error(`[issue-canvas] MCP server ready (${TOOLS.length} tools, store: ${describe})`);
}

main().catch((e) => {
  console.error("[issue-canvas] fatal:", e);
  process.exit(1);
});
