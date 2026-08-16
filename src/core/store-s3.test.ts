import { test } from "node:test";
import assert from "node:assert/strict";
import { createBoard, addNotes } from "./commands.js";
import { ConflictError } from "./store.js";
import { S3Store, type S3Like } from "./store-s3.js";

/** ETag / If-Match / If-None-Match を再現する最小のインメモリ S3 */
class FakeS3 implements S3Like {
  objects = new Map<string, { body: string; etag: string }>();
  private seq = 0;
  private err(name: string, status: number) {
    const e = new Error(name) as Error & { name: string; $metadata: { httpStatusCode: number } };
    e.name = name;
    e.$metadata = { httpStatusCode: status };
    return e;
  }
  async send(cmd: any): Promise<any> {
    const n = cmd.constructor.name;
    const i = cmd.input;
    if (n === "GetObjectCommand") {
      const o = this.objects.get(i.Key);
      if (!o) throw this.err("NoSuchKey", 404);
      return { ETag: o.etag, Body: { transformToString: async () => o.body } };
    }
    if (n === "HeadObjectCommand") {
      if (!this.objects.has(i.Key)) throw this.err("NotFound", 404);
      return {};
    }
    if (n === "PutObjectCommand") {
      const cur = this.objects.get(i.Key);
      if (i.IfNoneMatch === "*" && cur) throw this.err("PreconditionFailed", 412);
      if (i.IfMatch && (!cur || cur.etag !== i.IfMatch)) throw this.err("PreconditionFailed", 412);
      const etag = `"e${++this.seq}"`;
      this.objects.set(i.Key, { body: String(i.Body), etag });
      return { ETag: etag };
    }
    if (n === "ListObjectsV2Command") {
      const keys = [...this.objects.keys()].filter((k) => k.startsWith(i.Prefix));
      if (i.Delimiter) {
        const prefixes = new Set(keys.map((k) => i.Prefix + k.slice(i.Prefix.length).split("/")[0] + "/"));
        return { CommonPrefixes: [...prefixes].map((Prefix) => ({ Prefix })), IsTruncated: false };
      }
      return { Contents: keys.map((Key) => ({ Key })), IsTruncated: false };
    }
    if (n === "DeleteObjectsCommand") {
      for (const o of i.Delete.Objects) this.objects.delete(o.Key);
      return {};
    }
    throw new Error(`unexpected command ${n}`);
  }
}

test("S3Store: create/load/list/exists/delete with per-board prefix", async () => {
  const s3 = new FakeS3();
  const store = new S3Store("bkt", "boards/", s3);
  const b = createBoard("alpha", "問い");
  await store.save(b);
  assert.ok(s3.objects.has("boards/alpha/board.json"));
  assert.equal(await store.exists("alpha"), true);
  assert.equal(await store.exists("beta"), false);
  const loaded = await store.load("alpha");
  assert.equal(loaded.title, "問い");
  const list = await store.list();
  assert.deepEqual(list.map((x) => x.id), ["alpha"]);
  // 削除はプレフィックス配下ごと(将来の history/ も一緒に消える)
  s3.objects.set("boards/alpha/history/1.json", { body: "{}", etag: '"h"' });
  assert.equal(await store.delete("alpha"), true);
  assert.equal(s3.objects.size, 0);
  assert.equal(await store.delete("alpha"), false);
});

test("S3Store: concurrent writers -> second save without fresh load raises ConflictError", async () => {
  const s3 = new FakeS3();
  const web = new S3Store("bkt", "boards/", s3);
  const mcp = new S3Store("bkt", "boards/", s3);
  await web.save(createBoard("b", "t"));

  const b1 = await web.load("b");
  const b2 = await mcp.load("b");
  addNotes(b1, ["from web"]);
  await web.save(b1); // OK: ETag matches
  addNotes(b2, ["from mcp"]);
  await assert.rejects(() => mcp.save(b2), ConflictError); // stale ETag
  // 再読込→再適用で通る
  const b3 = await mcp.load("b");
  addNotes(b3, ["from mcp (retry)"]);
  await mcp.save(b3);
  assert.equal((await web.load("b")).notes.length, 2);
});

test("S3Store: create twice (IfNoneMatch) conflicts", async () => {
  const s3 = new FakeS3();
  const a = new S3Store("bkt", "boards/", s3);
  const b = new S3Store("bkt", "boards/", s3);
  await a.save(createBoard("x", "1"));
  await assert.rejects(() => b.save(createBoard("x", "2")), ConflictError);
});
