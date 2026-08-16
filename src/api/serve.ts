#!/usr/bin/env node
/**
 * ローカル起動: API + (ビルド済みなら) web/dist の静的配信。
 *   npm run web:build && npm run serve   → http://localhost:8787
 * 開発時は `npm run web:dev`(Vite, /api を 8787 にプロキシ)と併用。
 */
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { JsonFileStore } from "../core/store.js";
import { createApp } from "./app.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..", "..");
const DATA_DIR = process.env.ISSUE_CANVAS_DATA ?? path.join(ROOT, "data");
const PORT = Number(process.env.PORT ?? 8787);
const WEB_DIST = path.join(ROOT, "web", "dist");

const store = new JsonFileStore(DATA_DIR);
await store.ensureDir();
const app = createApp(store);

if (existsSync(WEB_DIST)) {
  const rel = path.relative(process.cwd(), WEB_DIST).split(path.sep).join("/") || ".";
  app.use("/*", serveStatic({ root: rel }));
  app.get("*", serveStatic({ root: rel, path: "index.html" }));
}

serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" }, (info) => {
  console.log(`[issue-canvas] http://127.0.0.1:${info.port}  data=${DATA_DIR}  web=${existsSync(WEB_DIST) ? "served" : "not built"}`);
});
