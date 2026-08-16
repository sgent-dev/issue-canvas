/**
 * JSON ファイルストア。1 ボード = 1 ファイル (data/<boardId>.json)。
 * 書き込みは tmp → rename のアトミック置換。
 * 将来 SQLite 等に差し替えられるよう Store インターフェースで分離。
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { Board } from "./types.js";

export interface Store {
  list(): Promise<{ id: string; title: string; updatedAt: string }[]>;
  load(id: string): Promise<Board>;
  save(board: Board): Promise<void>;
  exists(id: string): Promise<boolean>;
  /** ボードを丸ごと削除(復元不可)。存在しなければ false */
  delete(id: string): Promise<boolean>;
}

export class JsonFileStore implements Store {
  constructor(private readonly dir: string) {}

  private file(id: string): string {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error(`invalid board id: ${id}`);
    return path.join(this.dir, `${id}.json`);
  }

  async ensureDir(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  async list() {
    await this.ensureDir();
    const names = (await fs.readdir(this.dir)).filter((n) => n.endsWith(".json"));
    const out: { id: string; title: string; updatedAt: string }[] = [];
    for (const n of names) {
      try {
        const b = JSON.parse(await fs.readFile(path.join(this.dir, n), "utf8")) as Board;
        out.push({ id: b.id, title: b.title, updatedAt: b.updatedAt });
      } catch {
        // 壊れたファイルは一覧から除外(削除はしない)
      }
    }
    out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return out;
  }

  async exists(id: string): Promise<boolean> {
    try {
      await fs.access(this.file(id));
      return true;
    } catch {
      return false;
    }
  }

  async load(id: string): Promise<Board> {
    const raw = await fs.readFile(this.file(id), "utf8");
    const b = JSON.parse(raw) as Board;
    if (b.version !== 1) throw new Error(`unsupported board version: ${String(b.version)}`);
    return b;
  }

  async save(board: Board): Promise<void> {
    await this.ensureDir();
    const target = this.file(board.id);
    const tmp = `${target}.${randomBytes(4).toString("hex")}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(board, null, 2) + "\n", "utf8");
    await fs.rename(tmp, target);
  }

  async delete(id: string): Promise<boolean> {
    try {
      await fs.unlink(this.file(id));
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw e;
    }
  }
}

export class MemoryStore implements Store {
  private boards = new Map<string, Board>();
  async list() {
    return [...this.boards.values()].map((b) => ({ id: b.id, title: b.title, updatedAt: b.updatedAt }));
  }
  async load(id: string): Promise<Board> {
    const b = this.boards.get(id);
    if (!b) throw new Error(`board not found: ${id}`);
    return structuredClone(b);
  }
  async save(board: Board): Promise<void> {
    this.boards.set(board.id, structuredClone(board));
  }
  async exists(id: string): Promise<boolean> {
    return this.boards.has(id);
  }
  async delete(id: string): Promise<boolean> {
    return this.boards.delete(id);
  }
}
