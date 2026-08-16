import { useState } from "react";
import type { Board, Note, SubTask, Task, TodoGroup } from "../../../src/core/types.ts";
import { cardOf, locationOptions, pathOf, statusClass } from "../lib.ts";
import type { Cmd } from "./Canvas.tsx";
import { Ctl, InlineText, LocationSelect } from "./ui.tsx";

type Tab = "memo" | "list" | "todo";

export function Panel({ board, cmd, onFocus, toast }: { board: Board; cmd: Cmd; onFocus: (cardId: string) => void; toast: (m: string) => void }) {
  const [tab, setTab] = useState<Tab>("memo");
  const pending = board.notes.filter((n) => !cardOf(board, n.cardId)).length;
  let done = 0,
    total = 0;
  for (const g of board.todoGroups)
    for (const t of g.tasks) {
      total++;
      if (t.done) done++;
      for (const s of t.subs) {
        total++;
        if (s.done) done++;
      }
    }
  return (
    <aside className="panel">
      <div className="panel-tabs">
        <button className={tab === "memo" ? "active" : ""} onClick={() => setTab("memo")}>
          メモ {pending > 0 && <span className="cnt warn">未反映 {pending}</span>}
        </button>
        <button className={tab === "list" ? "active" : ""} onClick={() => setTab("list")}>
          カード一覧 <span className="cnt">{board.cards.length}</span>
        </button>
        <button className={tab === "todo" ? "active" : ""} onClick={() => setTab("todo")}>
          TODO {total > 0 && <span className="cnt">{done}/{total}</span>}
        </button>
      </div>
      <div className="panel-view">
        {tab === "memo" && <MemoTab board={board} cmd={cmd} onFocus={onFocus} toast={toast} />}
        {tab === "list" && <ListTab board={board} onFocus={onFocus} />}
        {tab === "todo" && <TodoTab board={board} cmd={cmd} onFocus={onFocus} toast={toast} />}
      </div>
    </aside>
  );
}

// ---------- memo ----------
function MemoTab({ board, cmd, onFocus, toast }: { board: Board; cmd: Cmd; onFocus: (id: string) => void; toast: (m: string) => void }) {
  const [raw, setRaw] = useState("");
  const [filter, setFilter] = useState<"all" | "pending" | "linked">("all");
  const ingest = async () => {
    const lines = raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!lines.length) return;
    await cmd("note_add", { texts: lines });
    setRaw("");
    toast(`${lines.length}件をメモに取り込みました`);
  };
  const notes = [...board.notes].reverse();
  return (
    <>
      <div className="memo-input">
        <label htmlFor="memoRaw">思いついたまま書く</label>
        <textarea
          id="memoRaw"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="要件・気になること・疑問を、1行1メモで。整理は後でカード側でやります。"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              ingest();
            }
          }}
        />
        <div className="row">
          <span className="hint">Ctrl+Enter でも取り込めます</span>
          <button className="btn" onClick={ingest}>
            メモに取り込む
          </button>
        </div>
      </div>
      <div className="memo-list">
        <div className="memo-filter">
          {(["all", "pending", "linked"] as const).map((f) => (
            <button key={f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
              {f === "all" ? "すべて" : f === "pending" ? "未反映" : "カード化済み"}
            </button>
          ))}
        </div>
        {notes
          .filter((n) => {
            const linked = !!cardOf(board, n.cardId);
            return filter === "all" || (filter === "pending" ? !linked : linked);
          })
          .map((n) => (
            <NoteRow key={n.id} n={n} board={board} cmd={cmd} onFocus={onFocus} toast={toast} />
          ))}
        {notes.length === 0 && <p className="hint">メモはまだありません。上のテキストエリアか、Claude(MCP)の note_add から。</p>}
      </div>
    </>
  );
}

function NoteRow({ n, board, cmd, onFocus, toast }: { n: Note; board: Board; cmd: Cmd; onFocus: (id: string) => void; toast: (m: string) => void }) {
  const card = cardOf(board, n.cardId);
  const [editing, setEditing] = useState(false);
  const [dest, setDest] = useState("");
  const opts = locationOptions(board);
  const toCard = async () => {
    const o = opts.find((x) => x.value === dest)!;
    const r = (await cmd("note_to_card", { noteId: n.id, frameId: o.frameId, sectionId: o.sectionId })) as { id: string };
    toast(`カード化 → ${o.label}。未判定なので「⟳ 再判定待ち」が付きます`);
    onFocus(r.id);
  };
  return (
    <div className={`note ${card ? "linked" : "pending"}`}>
      <InlineText as="p" className="note-text" value={n.text} editing={editing} onEditingChange={setEditing} multiline onCommit={(v) => cmd("note_update", { noteId: n.id, text: v })} />
      <div className="note-foot">
        {card ? (
          <button className="note-link" onClick={() => onFocus(card.id)}>
            → {pathOf(board, card)}
          </button>
        ) : (
          <>
            <span className="note-state pending">未反映</span>
            <LocationSelect options={opts} value={dest} onChange={setDest} />
            <button className="note-act suggest" onClick={toCard}>
              カード化
            </button>
          </>
        )}
        <Ctl onEdit={() => setEditing(true)} onDelete={() => cmd("note_delete", { noteId: n.id }).then(() => toast(card ? "メモを削除。カードは残ります" : "メモを削除しました"))} />
      </div>
    </div>
  );
}

// ---------- list ----------
function ListTab({ board, onFocus }: { board: Board; onFocus: (id: string) => void }) {
  const groups: { name: string; cards: typeof board.cards }[] = board.frames.map((f) => ({ name: f.name, cards: board.cards.filter((c) => c.frameId === f.id) }));
  groups.push({ name: "未分類", cards: board.cards.filter((c) => c.frameId === null) });
  return (
    <div className="list-view">
      {groups.map((g) => (
        <div className="list-group" key={g.name}>
          <h3>{g.name}</h3>
          {g.cards.length === 0 && <div className="list-empty">カードなし</div>}
          {g.cards.map((c) => {
            const f = board.frames.find((x) => x.id === c.frameId);
            const sec = f && c.sectionId ? f.sections.find((s) => s.id === c.sectionId) : undefined;
            const hasFlag = board.flags.some((fl) => fl.status === "open" && (fl.cardId === c.id || fl.targetCardId === c.id));
            return (
              <div className="list-row" key={c.id} onClick={() => onFocus(c.id)}>
                <span className={`pill ${statusClass[c.status]}`}>{c.status}</span>
                <span className="t">{c.text}</span>
                {sec && <span className="path">{sec.name}</span>}
                {hasFlag && <span className="badge">⚠</span>}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ---------- todo ----------
function TodoTab({ board, cmd, onFocus, toast }: { board: Board; cmd: Cmd; onFocus: (id: string) => void; toast: (m: string) => void }) {
  const grouped = new Set(board.todoGroups.map((g) => g.cardId));
  const candidates = board.cards.filter((c) => c.status === "結論" && !grouped.has(c.id));
  return (
    <div className="todo-view">
      <p className="todo-intro">結論が出た要件(カード)ごとにタスクグループを作り、その中で細分化して進める。グループはカードに紐づく。</p>
      {board.todoGroups.map((g) => (
        <GroupView key={g.id} g={g} board={board} cmd={cmd} onFocus={onFocus} toast={toast} />
      ))}
      <div className="todo-new">
        <div className="lbl">結論済みでタスク化されていない要件</div>
        {candidates.length === 0 && <div className="none">なし — カードのステータスが「結論」になると、ここに現れます</div>}
        {candidates.map((c) => (
          <div className="cand" key={c.id}>
            <span className="t">{c.text}</span>
            <button onClick={() => cmd("todo_group_create", { cardId: c.id }).then(() => toast("タスクグループを作成しました"))}>グループ作成</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function GroupView({ g, board, cmd, onFocus, toast }: { g: TodoGroup; board: Board; cmd: Cmd; onFocus: (id: string) => void; toast: (m: string) => void }) {
  const card = cardOf(board, g.cardId);
  const flat = g.tasks.flatMap((t) => [t, ...t.subs]);
  const done = flat.filter((t) => t.done).length;
  const [addingSubFor, setAddingSubFor] = useState<string | null>(null);
  const [newTask, setNewTask] = useState("");
  const [newSub, setNewSub] = useState("");
  return (
    <div className="tgroup">
      <div className="tgroup-head">
        <InlineText as="span" className="tgroup-title" value={g.title} onCommit={(v) => cmd("todo_group_update", { groupId: g.id, title: v })} />
        {card ? (
          <button className="tgroup-src" title="要件カードを表示" onClick={() => onFocus(card.id)}>
            ⇢ {pathOf(board, card)}
          </button>
        ) : (
          <span className="tgroup-src orphan" title="グループは残ります。別カードに付け替えるか、不要なら削除">
            要件カード削除済み
          </span>
        )}
        <Ctl onDelete={() => cmd("todo_group_delete", { groupId: g.id }).then(() => toast("タスクグループを削除。要件カードには影響しません"))} />
      </div>
      <div className="tgroup-prog">
        <span className="prog-bar">
          <i style={{ width: `${flat.length ? Math.round((done / flat.length) * 100) : 0}%` }} />
        </span>
        <span className="n">
          {done}/{flat.length}
        </span>
      </div>
      <div className="tasks">
        {g.tasks.map((t) => (
          <div key={t.id}>
            <TaskRow t={t} g={g} cmd={cmd} onSub={() => setAddingSubFor(t.id)} />
            {t.subs.map((s) => (
              <TaskRow key={s.id} t={s} g={g} cmd={cmd} sub />
            ))}
            {addingSubFor === t.id && (
              <div className="task-add sub">
                <input
                  autoFocus
                  value={newSub}
                  onChange={(e) => setNewSub(e.target.value)}
                  placeholder={`「${t.text.slice(0, 14)}…」を細分化(Enter)`}
                  onBlur={() => setAddingSubFor(null)}
                  onKeyDown={async (e) => {
                    if (e.key === "Escape") setAddingSubFor(null);
                    if (e.key === "Enter" && newSub.trim()) {
                      await cmd("todo_task_add", { groupId: g.id, text: newSub.trim(), parentTaskId: t.id });
                      setNewSub("");
                    }
                  }}
                />
              </div>
            )}
          </div>
        ))}
        <div className="task-add">
          <input
            value={newTask}
            onChange={(e) => setNewTask(e.target.value)}
            placeholder="＋ タスクを追加(Enter)"
            onKeyDown={async (e) => {
              if (e.key === "Enter" && newTask.trim()) {
                await cmd("todo_task_add", { groupId: g.id, text: newTask.trim() });
                setNewTask("");
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}

function TaskRow({ t, g, cmd, sub, onSub }: { t: Task | SubTask; g: TodoGroup; cmd: Cmd; sub?: boolean; onSub?: () => void }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className={`task ${sub ? "sub" : ""} ${t.done ? "done" : ""}`}>
      <input type="checkbox" checked={t.done} onChange={(e) => cmd("todo_task_update", { groupId: g.id, taskId: t.id, done: e.target.checked })} />
      <InlineText as="span" className="task-text" value={t.text} editing={editing} onEditingChange={setEditing} onCommit={(v) => cmd("todo_task_update", { groupId: g.id, taskId: t.id, text: v })} />
      <Ctl
        onEdit={() => setEditing(true)}
        onDelete={() => cmd("todo_task_delete", { groupId: g.id, taskId: t.id })}
        extra={
          !sub && onSub ? (
            <button className="tk-add" onClick={onSub}>
              ＋細分化
            </button>
          ) : undefined
        }
      />
    </div>
  );
}
