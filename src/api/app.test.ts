import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../core/store.js";
import { createApp } from "./app.js";

const json = (r: Response) => r.json() as Promise<any>;
const post = (app: ReturnType<typeof createApp>, url: string, body: unknown) =>
  app.request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("board lifecycle over REST: create -> cmd(frame/card/note) -> summary -> mece material", async () => {
  const app = createApp(new MemoryStore());
  let r = await post(app, "/api/boards", { id: "b1", title: "問い" });
  assert.equal(r.status, 201);

  r = await post(app, "/api/boards/b1/cmd", { name: "frame_create", args: { name: "A", scopeText: "Aの範囲" } });
  assert.equal(r.status, 200);
  const frame = (await json(r)).result;
  await post(app, "/api/boards/b1/cmd", { name: "frame_approve_scope", args: { frameId: frame.id } });

  r = await post(app, "/api/boards/b1/cmd", { name: "note_add", args: { texts: ["メモ1", "メモ2"] } });
  const notes = (await json(r)).result;
  r = await post(app, "/api/boards/b1/cmd", { name: "note_to_card", args: { noteId: notes[0].id, frameId: frame.id } });
  const { result: card, board } = await json(r);
  assert.equal(card.frameId, frame.id);
  assert.equal(board.notes[0].cardId, card.id);

  const s = await json(await app.request("/api/boards/b1/summary"));
  assert.equal(s.notes.pending, 1);
  assert.equal(s.staleCards, 1);

  const m = await json(await app.request("/api/boards/b1/mece"));
  assert.deepEqual(m.staleCardIds, [card.id]);
});

test("errors: unknown command 400, bad args 400, missing board 404, duplicate board 409", async () => {
  const app = createApp(new MemoryStore());
  await post(app, "/api/boards", { id: "b1", title: "t" });
  assert.equal((await post(app, "/api/boards", { id: "b1", title: "t" })).status, 409);
  await post(app, "/api/boards", { id: "b2", title: "t2" });
  assert.equal((await post(app, "/api/boards/b1/cmd", { name: "nope", args: {} })).status, 400);
  assert.equal((await post(app, "/api/boards/b1/cmd", { name: "card_update", args: { text: "x" } })).status, 400);
  assert.equal((await post(app, "/api/boards/b1/cmd", { name: "card_update", args: { cardId: "zz", text: "x" } })).status, 400);
  assert.equal((await app.request("/api/boards/nope")).status, 404);
  // store-scope tools are not exposed via cmd
  assert.equal((await post(app, "/api/boards/b1/cmd", { name: "board_create", args: { id: "x", title: "y" } })).status, 400);
  assert.equal((await post(app, "/api/boards/b1/cmd", { name: "board_delete", args: { id: "b1", confirm: "b1" } })).status, 400);
  // delete: 200 then 404
  assert.equal((await app.request("/api/boards/b2", { method: "DELETE" })).status, 200);
  assert.equal((await app.request("/api/boards/b2", { method: "DELETE" })).status, 404);
  assert.equal((await app.request("/api/boards/b2")).status, 404);
});
