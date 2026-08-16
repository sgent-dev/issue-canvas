import { useCallback, useEffect, useRef, useState } from "react";
import type { Board } from "../../src/core/types.ts";
import { ApiError, api } from "./api.ts";
import { Canvas, type Cmd } from "./components/Canvas.tsx";
import { Panel } from "./components/Panel.tsx";
import { InlineText, useToast } from "./components/ui.tsx";
import { isStale } from "./lib.ts";

const POLL_MS = 4000;

export function App() {
  const [boards, setBoards] = useState<{ id: string; title: string; updatedAt: string }[] | null>(null);
  const [boardId, setBoardId] = useState<string | null>(() => new URLSearchParams(location.search).get("board"));
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);
  const [meceOpen, setMeceOpen] = useState(false);
  const { msg, toast } = useToast();
  const busy = useRef(false);

  const refreshList = useCallback(() => api.listBoards().then(setBoards).catch((e) => setError(String(e))), []);
  useEffect(() => {
    refreshList();
  }, [refreshList]);

  // load + poll (MCP 側の変更を拾う)
  useEffect(() => {
    if (!boardId) return;
    let alive = true;
    const load = () =>
      api
        .getBoard(boardId)
        .then((b) => {
          if (!alive || busy.current) return;
          setBoard((prev) => (prev && prev.updatedAt === b.updatedAt ? prev : b));
          setError(null);
        })
        .catch((e) => {
          if (e instanceof ApiError && e.status === 404) {
            setBoardId(null);
            setBoard(null);
          } else setError(String(e));
        });
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), POLL_MS);
    const u = new URL(location.href);
    u.searchParams.set("board", boardId);
    history.replaceState(null, "", u);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [boardId]);

  const cmd: Cmd = useCallback(
    async (name, args = {}) => {
      if (!boardId) throw new Error("no board");
      busy.current = true;
      try {
        const { result, board: b } = await api.cmd(boardId, name, args);
        setBoard(b);
        return result;
      } catch (e) {
        toast(`エラー: ${e instanceof Error ? e.message : String(e)}`);
        throw e;
      } finally {
        busy.current = false;
      }
    },
    [boardId, toast],
  );

  const onFocus = useCallback((id: string) => setFocus((f) => ({ id, n: (f?.n ?? 0) + 1 })), []);

  if (!boardId || !board) {
    return (
      <BoardPicker
        boards={boards}
        error={error}
        onOpen={(id) => {
          setBoard(null);
          setBoardId(id);
        }}
        onCreate={async (id, title) => {
          await api.createBoard(id, title);
          await refreshList();
          setBoardId(id);
        }}
        onDelete={async (id) => {
          await api.deleteBoard(id);
          await refreshList();
        }}
      />
    );
  }

  const staleCount = board.cards.filter(isStale).length;
  return (
    <div className={`app ${panelOpen ? "panel-open" : ""}`}>
      <header className="appbar">
        <button className="board-chip" title="ボード一覧へ" onClick={() => setBoardId(null)}>
          ◀ {board.id}
        </button>
        <h1 className="top-issue">
          <span className="q">問</span>
          <InlineText as="span" value={board.title} onCommit={(v) => cmd("board_set_title", { title: v })} />
        </h1>
        <div className="appbar-actions">
          <span className={`stale-cnt ${staleCount ? "" : "zero"}`} title="新規・編集・移動後に判定をやり直していないカード数">
            {staleCount ? `再判定待ち ${staleCount}` : "判定は最新"}
          </span>
          <button className="btn btn-accent" onClick={() => setMeceOpen(true)}>
            MECE判定
          </button>
          <button className="btn" onClick={() => setPanelOpen((o) => !o)}>
            メモ / 一覧 / TODO
          </button>
        </div>
      </header>
      <Canvas board={board} cmd={cmd} focus={focus} toast={toast} />
      {panelOpen && <Panel board={board} cmd={cmd} onFocus={onFocus} toast={toast} />}
      <Legend />
      {meceOpen && <MeceModal boardId={board.id} staleCount={staleCount} onClose={() => setMeceOpen(false)} toast={toast} />}
      {error && <div className="err-bar">{error}</div>}
      <div className={`toast ${msg ? "show" : ""}`} role="status">
        {msg}
      </div>
    </div>
  );
}

function BoardPicker({
  boards,
  error,
  onOpen,
  onCreate,
  onDelete,
}: {
  boards: { id: string; title: string; updatedAt: string }[] | null;
  error: string | null;
  onOpen: (id: string) => void;
  onCreate: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [id, setId] = useState("");
  const [title, setTitle] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState("");
  return (
    <div className="picker">
      <div className="picker-card">
        <h1>
          <span className="q">問</span>Issue Canvas
        </h1>
        <p className="hint">検討テーマ(ボード)を選ぶか、新しく作ります。ボードは Claude(MCP)からも同じものが見えます。</p>
        {error && <p className="err">{error}</p>}
        <ul className="board-list">
          {boards === null && <li className="hint">読み込み中…</li>}
          {boards?.length === 0 && <li className="hint">ボードはまだありません</li>}
          {boards?.map((b) => (
            <li key={b.id} className="board-row">
              <button className="board-open" onClick={() => onOpen(b.id)}>
                <span className="bid">{b.id}</span>
                <span className="btitle">{b.title}</span>
                <span className="bdate">{b.updatedAt.slice(0, 16).replace("T", " ")}</span>
              </button>
              {deleting === b.id ? (
                <form
                  className="board-del-confirm"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (confirmId !== b.id) return;
                    setErr(null);
                    try {
                      await onDelete(b.id);
                      setDeleting(null);
                      setConfirmId("");
                    } catch (e) {
                      setErr(e instanceof Error ? e.message : String(e));
                    }
                  }}
                >
                  <span className="hint">復元できません。確認のため id「{b.id}」を入力:</span>
                  <input autoFocus value={confirmId} onChange={(e) => setConfirmId(e.target.value)} placeholder={b.id} />
                  <button type="submit" className="btn btn-danger" disabled={confirmId !== b.id}>
                    完全に削除
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setDeleting(null);
                      setConfirmId("");
                    }}
                  >
                    取消
                  </button>
                </form>
              ) : (
                <button
                  className="board-del"
                  title="このボードを削除"
                  onClick={() => {
                    setDeleting(b.id);
                    setConfirmId("");
                  }}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
        <form
          className="new-board"
          onSubmit={async (e) => {
            e.preventDefault();
            setErr(null);
            try {
              await onCreate(id.trim(), title.trim());
            } catch (e) {
              setErr(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          <div className="lbl">新しいボード</div>
          <input value={id} onChange={(e) => setId(e.target.value)} placeholder="id(英数字・-・_)" pattern="[A-Za-z0-9_-]{1,64}" required />
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="トップイシュー(答えを出したい問い)" required />
          <button className="btn btn-accent" type="submit">
            作成
          </button>
          {err && <p className="err">{err}</p>}
        </form>
      </div>
    </div>
  );
}

function MeceModal({ boardId, staleCount, onClose, toast }: { boardId: string; staleCount: number; onClose: () => void; toast: (m: string) => void }) {
  const prompt = `issue-canvas の board「${boardId}」を MECE 判定して。mece_material で材料を取って、越境・重複・依存・モレを判定し、mece_report で書き戻して。結果は要約して教えて。`;
  const copy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    toast(`${label}をコピーしました`);
  };
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>MECE判定</h2>
        <p>
          判定はこのアプリではなく <b>Claude(MCP 経由)</b> が行います。API 費用をボタンごとに払わないための設計です。
          現在 <b>再判定待ち {staleCount} 件</b>。
        </p>
        <ol>
          <li>
            Claude Code / Desktop で次のように依頼:
            <pre>{prompt}</pre>
            <button className="btn" onClick={() => copy(prompt, "依頼文")}>
              依頼文をコピー
            </button>
          </li>
          <li>
            MCP が使えない環境なら、判定材料(JSON)を貼り付けて判定してもらい、結果を Claude に <code>mece_report</code> の形で書き戻してもらう:
            <button className="btn" onClick={() => api.getMece(boardId).then((m) => copy(JSON.stringify(m, null, 2), "判定材料"))}>
              判定材料をコピー
            </button>
          </li>
        </ol>
        <p className="hint">判定結果が保存されると、この画面は数秒以内に自動で更新されます(警告線・モレ候補・再判定待ちの解消)。</p>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="legend">
      <div className="row">
        <svg width="34" height="8">
          <line x1="0" y1="4" x2="26" y2="4" stroke="var(--danger)" strokeWidth="1.6" strokeDasharray="6 5" />
          <path d="M26,0 L34,4 L26,8 z" fill="var(--danger)" />
        </svg>
        越境 — 別の大項目の範囲(移動を提案)
      </div>
      <div className="row">
        <svg width="34" height="8">
          <line x1="0" y1="4" x2="34" y2="4" stroke="var(--danger)" strokeWidth="1.6" strokeDasharray="6 5" />
        </svg>
        重複 — ほぼ同じ論点(統合を提案)
      </div>
      <div className="row">
        <svg width="34" height="8">
          <line x1="0" y1="4" x2="34" y2="4" stroke="var(--dep)" strokeWidth="1.6" strokeDasharray="2 5" strokeLinecap="round" />
        </svg>
        依存 — 前提関係(MECE違反ではない)
      </div>
      <div className="row">
        <svg width="34" height="10">
          <rect x="1" y="1" width="32" height="8" rx="3" fill="none" stroke="var(--ghost-line)" strokeWidth="1.4" strokeDasharray="4 3" />
        </svg>
        モレ候補 — 未検討領域(採用/不要)
      </div>
      <div className="row">
        <span className="stale">⟳ 再判定待ち</span>編集/追加後、判定をやり直していないカード
      </div>
    </div>
  );
}
