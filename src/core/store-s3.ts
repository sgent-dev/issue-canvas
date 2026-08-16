/**
 * S3 ストア。1 ボード = 1 オブジェクト: <prefix><boardId>/board.json
 * ボード単位のプレフィックス(フォルダ)にしておくのは、将来 history/ 等を同じ場所に置くため。
 *
 * 同時更新: load 時の ETag を覚えておき、save は If-Match 付き Put。
 * 別プロセス(MCP と Web)が先に保存していれば 412 → ConflictError。
 */
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { ConflictError, type Store } from "./store.js";
import type { Board } from "./types.js";

/** テストで差し替えられるよう、必要な API だけの最小インターフェース */
export interface S3Like {
  send(command: any): Promise<any>;
}

const isNotFound = (e: unknown): boolean => {
  const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
  return err?.name === "NoSuchKey" || err?.name === "NotFound" || err?.$metadata?.httpStatusCode === 404;
};
const isPreconditionFailed = (e: unknown): boolean => {
  const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
  return err?.name === "PreconditionFailed" || err?.$metadata?.httpStatusCode === 412;
};

export class S3Store implements Store {
  private readonly client: S3Like;
  private readonly etags = new Map<string, string>();

  constructor(
    private readonly bucket: string,
    private readonly prefix = "boards/",
    client?: S3Like,
    clientConfig?: S3ClientConfig,
  ) {
    this.client = client ?? new S3Client(clientConfig ?? {});
  }

  private key(id: string): string {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error(`invalid board id: ${id}`);
    return `${this.prefix}${id}/board.json`;
  }

  async list() {
    const ids: string[] = [];
    let token: string | undefined;
    do {
      const r = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: this.prefix, Delimiter: "/", ContinuationToken: token }),
      );
      for (const p of r.CommonPrefixes ?? []) {
        const id = String(p.Prefix ?? "")
          .slice(this.prefix.length)
          .replace(/\/$/, "");
        if (id) ids.push(id);
      }
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    const out: { id: string; title: string; updatedAt: string }[] = [];
    await Promise.all(
      ids.map(async (id) => {
        try {
          const b = await this.load(id);
          out.push({ id: b.id, title: b.title, updatedAt: b.updatedAt });
        } catch {
          // board.json が無い/壊れているプレフィックスは一覧から除外
        }
      }),
    );
    out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return out;
  }

  async exists(id: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.key(id) }));
      return true;
    } catch (e) {
      if (isNotFound(e)) return false;
      throw e;
    }
  }

  async load(id: string): Promise<Board> {
    let r;
    try {
      r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key(id) }));
    } catch (e) {
      if (isNotFound(e)) throw new Error(`board not found: ${id}`);
      throw e;
    }
    const text = await r.Body.transformToString("utf-8");
    const b = JSON.parse(text) as Board;
    if (b.version !== 1) throw new Error(`unsupported board version: ${String(b.version)}`);
    if (r.ETag) this.etags.set(id, r.ETag);
    return b;
  }

  async save(board: Board): Promise<void> {
    const etag = this.etags.get(board.id);
    try {
      const r = await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: this.key(board.id),
          Body: JSON.stringify(board, null, 2) + "\n",
          ContentType: "application/json; charset=utf-8",
          // 既知の ETag があればそれと一致する時だけ上書き。未知(新規作成)なら「存在しない時だけ」
          ...(etag ? { IfMatch: etag } : { IfNoneMatch: "*" }),
        }),
      );
      if (r.ETag) this.etags.set(board.id, r.ETag);
    } catch (e) {
      if (isPreconditionFailed(e)) {
        this.etags.delete(board.id);
        throw new ConflictError(`board ${board.id} was modified by another process; reload and retry`);
      }
      throw e;
    }
  }

  async delete(id: string): Promise<boolean> {
    const dir = `${this.prefix}${id}/`;
    let existed = false;
    let token: string | undefined;
    do {
      const r = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: dir, ContinuationToken: token }));
      const keys = (r.Contents ?? []).map((o: { Key?: string }) => o.Key).filter((k: string | undefined): k is string => !!k);
      if (keys.includes(this.key(id))) existed = true;
      if (keys.length) {
        await this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys.map((Key: string) => ({ Key })), Quiet: true } }));
      }
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    this.etags.delete(id);
    return existed;
  }
}
