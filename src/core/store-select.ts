/**
 * 環境変数でストアを選ぶ。
 *   ISSUE_CANVAS_STORE=s3   → S3Store(ISSUE_CANVAS_BUCKET 必須, ISSUE_CANVAS_PREFIX 任意, AWS 認証は SDK の既定チェーン)
 *   それ以外(既定)          → JsonFileStore(ISSUE_CANVAS_DATA または <repo>/data)
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JsonFileStore, type Store } from "./store.js";
import { S3Store } from "./store-s3.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export function createStoreFromEnv(env: NodeJS.ProcessEnv = process.env): { store: Store; describe: string } {
  if (env.ISSUE_CANVAS_STORE === "s3") {
    const bucket = env.ISSUE_CANVAS_BUCKET;
    if (!bucket) throw new Error("ISSUE_CANVAS_BUCKET is required when ISSUE_CANVAS_STORE=s3");
    const prefix = env.ISSUE_CANVAS_PREFIX ?? "boards/";
    return { store: new S3Store(bucket, prefix), describe: `s3://${bucket}/${prefix}` };
  }
  const dir = env.ISSUE_CANVAS_DATA ?? path.resolve(here, "..", "..", "data");
  return { store: new JsonFileStore(dir), describe: dir };
}
