/**
 * REST API (Hono)。ランタイム非依存 — ローカル(node-server)でも Lambda でも同じ app を使う。
 *
 *   GET  /api/boards                 一覧
 *   POST /api/boards {id,title}      作成
 *   GET  /api/boards/:id             full
 *   GET  /api/boards/:id/summary
 *   GET  /api/boards/:id/mece        判定材料(Claude に渡す用)
 *   POST /api/boards/:id/cmd {name,args}   コマンド実行(src/core/tools.ts の board/board-read ツール)
 *   DELETE /api/boards/:id           ボード削除(復元不可)
 */
import { Hono } from "hono";
import { z } from "zod";
import { CommandError } from "../core/commands.js";
import type { Store } from "../core/store.js";
import { TOOLS, toolByName } from "../core/tools.js";
import * as C from "../core/commands.js";

export function createApp(store: Store): Hono {
  const app = new Hono();

  app.onError((e, c) => {
    if (e instanceof CommandError) return c.json({ error: e.message }, 400);
    if (e instanceof z.ZodError) return c.json({ error: "invalid arguments", issues: e.issues }, 400);
    const msg = e instanceof Error ? e.message : String(e);
    if (/ENOENT|not found/i.test(msg)) return c.json({ error: msg }, 404);
    console.error(e);
    return c.json({ error: "internal error" }, 500);
  });

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.get("/api/tools", (c) =>
    c.json(TOOLS.map((t) => ({ name: t.name, title: t.title, scope: t.scope, description: t.description }))),
  );

  app.get("/api/boards", async (c) => c.json(await store.list()));

  app.post("/api/boards", async (c) => {
    const body = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), title: z.string().min(1) }).parse(await c.req.json());
    if (await store.exists(body.id)) return c.json({ error: `board already exists: ${body.id}` }, 409);
    const b = C.createBoard(body.id, body.title);
    await store.save(b);
    return c.json(b, 201);
  });

  app.get("/api/boards/:id", async (c) => c.json(await store.load(c.req.param("id"))));
  app.delete("/api/boards/:id", async (c) => {
    const id = c.req.param("id");
    if (!(await store.delete(id))) return c.json({ error: `board not found: ${id}` }, 404);
    return c.json({ deleted: id });
  });
  app.get("/api/boards/:id/summary", async (c) => c.json(C.summary(await store.load(c.req.param("id")))));
  app.get("/api/boards/:id/mece", async (c) => c.json(C.meceMaterial(await store.load(c.req.param("id")))));

  const cmdBody = z.object({ name: z.string(), args: z.record(z.unknown()).optional() });
  app.post("/api/boards/:id/cmd", async (c) => {
    const { name, args } = cmdBody.parse(await c.req.json());
    const tool = toolByName.get(name);
    if (!tool || tool.scope === "store") return c.json({ error: `unknown command: ${name}` }, 400);
    const parsed = z.object(tool.schema).parse(args ?? {});
    const b = await store.load(c.req.param("id"));
    const result = await tool.run(b, parsed);
    if (tool.scope === "board") await store.save(b);
    // UI は毎回ボード全体を再取得しなくて済むよう、結果と一緒に最新ボードを返す
    return c.json({ result, board: b });
  });

  return app;
}
