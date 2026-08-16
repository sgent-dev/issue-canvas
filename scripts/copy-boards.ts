/**
 * ローカル JSON(data/) のボードを S3 へコピーする(移行用、上書きなし)。
 *   ISSUE_CANVAS_BUCKET=<bucket> npx tsx scripts/copy-boards.ts [dataDir]
 * 逆方向(S3 → ローカル)は --pull
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JsonFileStore } from "../src/core/store.js";
import { S3Store } from "../src/core/store-s3.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const pull = process.argv.includes("--pull");
const dirArg = process.argv.slice(2).find((a) => !a.startsWith("--"));
const dir = dirArg ?? path.resolve(here, "..", "data");
const bucket = process.env.ISSUE_CANVAS_BUCKET;
if (!bucket) throw new Error("ISSUE_CANVAS_BUCKET is required");

const local = new JsonFileStore(dir);
const s3 = new S3Store(bucket, process.env.ISSUE_CANVAS_PREFIX ?? "boards/");
const [from, to] = pull ? [s3, local] : [local, s3];

for (const { id } of await from.list()) {
  if (await to.exists(id)) {
    console.log(`skip ${id} (already exists at destination)`);
    continue;
  }
  await to.save(await from.load(id));
  console.log(`copied ${id}`);
}
