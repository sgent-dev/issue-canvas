import type { Board } from "../../src/core/types.ts";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError((body as { error?: string }).error ?? r.statusText, r.status);
  return body as T;
}

export const api = {
  listBoards: () => req<{ id: string; title: string; updatedAt: string }[]>("/api/boards"),
  createBoard: (id: string, title: string) => req<Board>("/api/boards", { method: "POST", body: JSON.stringify({ id, title }) }),
  getBoard: (id: string) => req<Board>(`/api/boards/${encodeURIComponent(id)}`),
  deleteBoard: (id: string) => req<{ deleted: string }>(`/api/boards/${encodeURIComponent(id)}`, { method: "DELETE" }),
  getMece: (id: string) => req<unknown>(`/api/boards/${encodeURIComponent(id)}/mece`),
  cmd: <R = unknown>(id: string, name: string, args: Record<string, unknown> = {}) =>
    req<{ result: R; board: Board }>(`/api/boards/${encodeURIComponent(id)}/cmd`, { method: "POST", body: JSON.stringify({ name, args }) }),
};
