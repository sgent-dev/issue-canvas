import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Board, Card, Flag, Frame, Gap, Section } from "../../../src/core/types.ts";
import { STATUSES, cardOf, flagsForCard, frameOf, isStale, locationOptions, locationValue, openFlags, openGaps, progress, statusClass } from "../lib.ts";
import { ConfirmButton, Ctl, InlineText, LocationSelect, Popover } from "./ui.tsx";

export type Cmd = (name: string, args?: Record<string, unknown>) => Promise<unknown>;

const WORLD_W = 1400;

export function Canvas({ board, cmd, focus, toast }: { board: Board; cmd: Cmd; focus: { id: string; n: number } | null; toast: (m: string) => void }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ scale: 0.85, tx: 24, ty: 20 });
  const [wires, setWires] = useState<WireSeg[]>([]);
  const [flashId, setFlashId] = useState<string | null>(null);
  const els = useRef(new Map<string, HTMLElement>());
  const register = useCallback((id: string, el: HTMLElement | null) => {
    if (el) els.current.set(id, el);
    else els.current.delete(id);
  }, []);

  // ---- pan / zoom ----
  const pan = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest("button, input, textarea, select, .pop, [contenteditable]")) return;
    pan.current = { x: e.clientX, y: e.clientY };
    viewportRef.current?.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pan.current) return;
    const dx = e.clientX - pan.current.x,
      dy = e.clientY - pan.current.y;
    pan.current = { x: e.clientX, y: e.clientY };
    setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
  };
  const onPointerUp = () => (pan.current = null);
  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    setView((v) => {
      const next = Math.min(2, Math.max(0.3, v.scale * factor));
      const vp = viewportRef.current!;
      const px = cx ?? vp.clientWidth / 2,
        py = cy ?? vp.clientHeight / 2;
      return { scale: next, tx: px - (px - v.tx) * (next / v.scale), ty: py - (py - v.ty) * (next / v.scale) };
    });
  }, []);
  useEffect(() => {
    const vp = viewportRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = vp.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.08 : 0.92, e.clientX - r.left, e.clientY - r.top);
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  }, [zoomAt]);
  const fit = useCallback(() => {
    const vp = viewportRef.current!,
      w = worldRef.current!;
    const pad = 30;
    const s = Math.max(0.3, Math.min((vp.clientWidth - pad * 2) / WORLD_W, (vp.clientHeight - pad * 2) / Math.max(400, w.scrollHeight), 1.2));
    setView({ scale: s, tx: (vp.clientWidth - WORLD_W * s) / 2, ty: pad });
  }, []);
  useEffect(() => {
    fit();
  }, [fit, board.id]);

  // ---- wires (open flags) ----
  useLayoutEffect(() => {
    const w = worldRef.current;
    if (!w) return;
    const wr = w.getBoundingClientRect();
    const rect = (id: string) => {
      const el = els.current.get(id);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: (r.left - wr.left) / view.scale, y: (r.top - wr.top) / view.scale, w: r.width / view.scale, h: r.height / view.scale };
    };
    const segs: WireSeg[] = [];
    for (const f of openFlags(board)) {
      const a = rect(`card:${f.cardId}`);
      const b = f.type === "crossing" ? rect(`frame:${f.targetFrameId}`) : rect(`card:${f.targetCardId}`);
      if (!a || !b) continue;
      const [p1, p2] = anchors(a, b);
      segs.push({ id: f.id, type: f.type, p1, p2 });
    }
    setWires(segs);
  }, [board, view.scale]);

  // ---- focus ----
  useEffect(() => {
    if (!focus) return;
    const el = els.current.get(`card:${focus.id}`);
    const vp = viewportRef.current,
      w = worldRef.current;
    if (!el || !vp || !w) return;
    const wr = w.getBoundingClientRect(),
      r = el.getBoundingClientRect();
    const cx = (r.left - wr.left + r.width / 2) / view.scale,
      cy = (r.top - wr.top + r.height / 2) / view.scale;
    setView((v) => ({ ...v, tx: vp.clientWidth / 2 - cx * v.scale, ty: vp.clientHeight / 2 - cy * v.scale }));
    setFlashId(focus.id);
    const t = setTimeout(() => setFlashId(null), 1300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.n]);

  const boardGaps = openGaps(board).filter((g) => g.level === "board");
  const ctx: Ctx = { board, cmd, toast, register, flashId };

  return (
    <div className="viewport" ref={viewportRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
      <div className="world" ref={worldRef} style={{ width: WORLD_W, transform: `translate(${view.tx}px,${view.ty}px) scale(${view.scale})` }}>
        <svg className="wires" aria-hidden="true">
          <defs>
            <marker id="arrDanger" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L8,4 L0,8 z" className="m-danger" />
            </marker>
          </defs>
          {wires.map((s) => (
            <path key={s.id} d={bezier(s.p1, s.p2)} className={s.type === "dependency" ? "w-dep" : "w-danger"} markerEnd={s.type === "crossing" ? "url(#arrDanger)" : undefined} />
          ))}
        </svg>
        {wires
          .filter((s) => s.type !== "crossing")
          .map((s) => (
            <span key={`l-${s.id}`} className={`wire-label ${s.type === "duplicate" ? "dup" : "dep"}`} style={{ left: (s.p1.x + s.p2.x) / 2, top: (s.p1.y + s.p2.y) / 2 }}>
              {s.type === "duplicate" ? "重複?" : "依存"}
            </span>
          ))}

        {board.frames.map((f) => (
          <FrameView key={f.id} f={f} ctx={ctx} />
        ))}
        <UnassignedFrame ctx={ctx} />
        {boardGaps.map((g) => (
          <GhostFrame key={g.id} g={g} ctx={ctx} />
        ))}
        <NewFrameTile ctx={ctx} />
      </div>
      <div className="zoom-ctl">
        <button onClick={() => zoomAt(1 / 1.2)} aria-label="縮小">
          −
        </button>
        <span className="lvl">{Math.round(view.scale * 100)}%</span>
        <button onClick={() => zoomAt(1.2)} aria-label="拡大">
          ＋
        </button>
        <button onClick={fit}>全体</button>
      </div>
    </div>
  );
}

// ---------- geometry ----------
type Pt = { x: number; y: number };
type Box = { x: number; y: number; w: number; h: number };
type WireSeg = { id: string; type: Flag["type"]; p1: Pt; p2: Pt };
function anchors(a: Box, b: Box): [Pt, Pt] {
  if (a.x + a.w < b.x) return [{ x: a.x + a.w, y: a.y + a.h / 2 }, { x: b.x, y: b.y + b.h / 2 }];
  if (b.x + b.w < a.x) return [{ x: a.x, y: a.y + a.h / 2 }, { x: b.x + b.w, y: b.y + b.h / 2 }];
  if (a.y + a.h < b.y) return [{ x: a.x + a.w / 2, y: a.y + a.h }, { x: b.x + b.w / 2, y: b.y }];
  return [{ x: a.x + a.w / 2, y: a.y }, { x: b.x + b.w / 2, y: b.y + b.h }];
}
function bezier(p1: Pt, p2: Pt): string {
  const horiz = Math.abs(p2.x - p1.x) > Math.abs(p2.y - p1.y);
  const d = Math.max(40, (horiz ? Math.abs(p2.x - p1.x) : Math.abs(p2.y - p1.y)) / 2);
  const c1 = horiz ? `${p1.x < p2.x ? p1.x + d : p1.x - d},${p1.y}` : `${p1.x},${p2.y > p1.y ? p1.y + d : p1.y - d}`;
  const c2 = horiz ? `${p1.x < p2.x ? p2.x - d : p2.x + d},${p2.y}` : `${p2.x},${p2.y > p1.y ? p2.y - d : p2.y + d}`;
  return `M${p1.x},${p1.y} C${c1} ${c2} ${p2.x},${p2.y}`;
}

// ---------- frame ----------
type Ctx = { board: Board; cmd: Cmd; toast: (m: string) => void; register: (id: string, el: HTMLElement | null) => void; flashId: string | null };

function FrameView({ f, ctx }: { f: Frame; ctx: Ctx }) {
  const { board, cmd } = ctx;
  const pr = progress(board, f.id);
  const direct = board.cards.filter((c) => c.frameId === f.id && c.sectionId === null);
  const gaps = openGaps(board).filter((g) => g.level === "frame" && g.frameId === f.id);
  const [addingSec, setAddingSec] = useState(false);
  return (
    <div className="frame">
      <div className="frame-head" ref={(el) => ctx.register(`frame:${f.id}`, el)}>
        <div className="frame-title-row">
          <InlineText as="span" className="frame-name" value={f.name} onCommit={(v) => cmd("frame_update", { frameId: f.id, name: v })} />
          <ScopeChip f={f} ctx={ctx} />
          <Ctl
            onDelete={() => cmd("frame_delete", { frameId: f.id }).then(() => ctx.toast(`「${f.name}」を削除。配下カードは未分類へ`))}
            extra={
              <button title="中項目を追加" onClick={() => setAddingSec(true)}>
                ＋中
              </button>
            }
          />
        </div>
        {f.scope.text && <p className="scope">{f.scope.text}</p>}
        <div className="prog">
          <span className="prog-num">
            結論 {pr.done}/{pr.total}
          </span>
          <span className="prog-bar">
            <i style={{ width: `${pr.total ? Math.round((pr.done / pr.total) * 100) : 0}%` }} />
          </span>
        </div>
      </div>
      <div className="frame-body">
        {f.sections.map((s) => (
          <SectionView key={s.id} f={f} s={s} ctx={ctx} />
        ))}
        {addingSec && (
          <NewInput placeholder="中項目名(Enter)" onDone={() => setAddingSec(false)} onSubmit={(v) => cmd("section_create", { frameId: f.id, name: v })} />
        )}
        <div className="cards">
          {direct.map((c) => (
            <CardView key={c.id} c={c} ctx={ctx} />
          ))}
          {gaps.map((g) => (
            <GhostCard key={g.id} g={g} ctx={ctx} />
          ))}
          <AddCard frameId={f.id} sectionId={null} ctx={ctx} />
        </div>
      </div>
    </div>
  );
}

function ScopeChip({ f, ctx }: { f: Frame; ctx: Ctx }) {
  const { cmd } = ctx;
  const st = f.scope.status;
  const label = st === "approved" ? "✓ 定義承認済" : st === "draft" ? "草案 — 承認待ち" : "定義なし";
  const cls = st === "approved" ? "chip chip-approved" : st === "draft" ? "chip chip-draft" : "chip chip-none";
  return (
    <Popover trigger={<span className={cls}>{label}</span>} kind={st === "approved" ? "info" : "warn"} title="スコープ定義">
      {(close) => <ScopeEditor f={f} onSave={(t) => cmd("frame_update", { frameId: f.id, scopeText: t }).then(close)} onApprove={() => cmd("frame_approve_scope", { frameId: f.id }).then(close)} />}
    </Popover>
  );
}
function ScopeEditor({ f, onSave, onApprove }: { f: Frame; onSave: (t: string) => void; onApprove: () => void }) {
  const [t, setT] = useState(f.scope.text);
  return (
    <div className="pop-body">
      <p className="hint">この大項目が「含むもの / 含まないもの」を一文で。承認済みの定義だけが越境・モレ判定の基準になります。</p>
      <textarea rows={3} value={t} onChange={(e) => setT(e.target.value)} placeholder="例: 新規顧客との接点づくりから受注まで。既存顧客の追加受注は含まない。" />
      <div className="pop-actions">
        {t.trim() && t.trim() !== f.scope.text && (
          <button className="primary" onClick={() => onSave(t)}>
            保存(草案として)
          </button>
        )}
        {f.scope.status === "draft" && t.trim() === f.scope.text && (
          <button className="primary" onClick={onApprove}>
            承認する
          </button>
        )}
        {f.scope.status === "approved" && <span className="hint">承認済み。文面を変えると草案に戻り、配下カードは再判定待ちになります。</span>}
      </div>
    </div>
  );
}

function SectionView({ f, s, ctx }: { f: Frame; s: Section; ctx: Ctx }) {
  const cards = ctx.board.cards.filter((c) => c.sectionId === s.id);
  return (
    <div className="section">
      <div className="section-head">
        <InlineText as="span" className="section-name" value={s.name} onCommit={(v) => ctx.cmd("section_rename", { frameId: f.id, sectionId: s.id, name: v })} />
        <Ctl onDelete={() => ctx.cmd("section_delete", { frameId: f.id, sectionId: s.id })} />
      </div>
      <div className="cards">
        {cards.map((c) => (
          <CardView key={c.id} c={c} ctx={ctx} />
        ))}
        <AddCard frameId={f.id} sectionId={s.id} ctx={ctx} />
      </div>
    </div>
  );
}

function UnassignedFrame({ ctx }: { ctx: Ctx }) {
  const cards = ctx.board.cards.filter((c) => c.frameId === null);
  return (
    <div className="frame frame-unassigned">
      <div className="frame-head">
        <div className="frame-title-row">
          <span className="frame-name">未分類</span>
          <span className="chip chip-none">インボックス</span>
        </div>
        <p className="scope">まだどの大項目にも属さない検討中の内容。メモからのカード化はまずここに入る。</p>
      </div>
      <div className="frame-body">
        <div className="cards">
          {cards.map((c) => (
            <CardView key={c.id} c={c} ctx={ctx} />
          ))}
          <AddCard frameId={null} sectionId={null} ctx={ctx} />
        </div>
      </div>
    </div>
  );
}

function NewFrameTile({ ctx }: { ctx: Ctx }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="frame frame-new">
      {adding ? (
        <NewInput placeholder="大項目名(Enter)" onDone={() => setAdding(false)} onSubmit={(v) => ctx.cmd("frame_create", { name: v })} />
      ) : (
        <button className="btn-new" onClick={() => setAdding(true)}>
          ＋ 大項目を追加
        </button>
      )}
    </div>
  );
}

function NewInput({ placeholder, onSubmit, onDone }: { placeholder: string; onSubmit: (v: string) => Promise<unknown> | void; onDone: () => void }) {
  const [v, setV] = useState("");
  return (
    <input
      className="new-input"
      autoFocus
      placeholder={placeholder}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={onDone}
      onKeyDown={async (e) => {
        if (e.key === "Escape") onDone();
        if (e.key === "Enter" && v.trim()) {
          await onSubmit(v.trim());
          setV("");
          onDone();
        }
      }}
    />
  );
}

function AddCard({ frameId, sectionId, ctx }: { frameId: string | null; sectionId: string | null; ctx: Ctx }) {
  const [adding, setAdding] = useState(false);
  if (!adding)
    return (
      <button className="add-card" onClick={() => setAdding(true)}>
        ＋ カード
      </button>
    );
  return <NewInput placeholder="論点・検討内容(Enter)" onDone={() => setAdding(false)} onSubmit={(v) => ctx.cmd("card_create", { text: v, frameId, sectionId })} />;
}

// ---------- card ----------
function CardView({ c, ctx }: { c: Card; ctx: Ctx }) {
  const { board, cmd } = ctx;
  const [editing, setEditing] = useState(false);
  const flags = flagsForCard(board, c.id);
  const stale = isStale(c);
  const opts = locationOptions(board);
  return (
    <div className={`card ${stale ? "is-stale" : ""} ${ctx.flashId === c.id ? "flash" : ""}`} ref={(el) => ctx.register(`card:${c.id}`, el)}>
      <InlineText as="p" className="card-text" value={c.text} editing={editing} onEditingChange={setEditing} multiline onCommit={(v) => cmd("card_update", { cardId: c.id, text: v }).then(() => ctx.toast("本文を更新。紐づけは維持、「⟳ 再判定待ち」が付きます"))} />
      <div className="card-meta">
        <Popover trigger={<span className={`pill ${statusClass[c.status]}`}>{c.status}</span>} title="ステータス">
          {(close) => (
            <div className="pop-actions">
              {STATUSES.map((s) => (
                <button key={s} className={s === c.status ? "primary" : ""} onClick={() => cmd("card_update", { cardId: c.id, status: s }).then(close)}>
                  {s}
                </button>
              ))}
            </div>
          )}
        </Popover>
        {stale && (
          <span className="stale" title="新規・編集・移動後、判定をやり直していません。Claude(MCP)に「MECE判定して」と頼むか、右上の「MECE判定」から">
            ⟳ 再判定待ち
          </span>
        )}
        {flags.map((f) => (
          <FlagBadge key={f.id} f={f} c={c} ctx={ctx} />
        ))}
      </div>
      <Ctl
        onEdit={() => setEditing(true)}
        onDelete={() =>
          cmd("card_delete", { cardId: c.id }).then((r: any) =>
            ctx.toast(`削除しました。${r?.unlinkedNoteIds?.length ? " 出所メモは未反映に戻ります。" : ""}${r?.orphanedGroupIds?.length ? " TODOグループは「要件カード削除済み」として残ります。" : ""}`),
          )
        }
        extra={
          <Popover trigger={<button title="移動">⇄</button>} title="移動先">
            {(close) => (
              <LocationSelect
                options={opts}
                value={locationValue(c.frameId, c.sectionId)}
                onChange={(v) => {
                  const o = opts.find((x) => x.value === v)!;
                  cmd("card_move", { cardId: c.id, frameId: o.frameId, sectionId: o.sectionId }).then(close);
                }}
              />
            )}
          </Popover>
        }
      />
    </div>
  );
}

function FlagBadge({ f, c, ctx }: { f: Flag; c: Card; ctx: Ctx }) {
  const { board, cmd } = ctx;
  const isSource = f.cardId === c.id;
  const other = cardOf(board, isSource ? f.targetCardId : f.cardId);
  const targetFrame = frameOf(board, f.targetFrameId);
  const label = f.type === "crossing" ? "⚠ 越境?" : f.type === "duplicate" ? "⚠ 重複?" : "⇢ 依存";
  const title = f.type === "crossing" ? "⚠ 越境の疑い" : f.type === "duplicate" ? "⚠ 重複の疑い" : "依存関係";
  const kind = f.type === "dependency" ? "info" : "danger";
  const targetSec = targetFrame && f.targetSectionId ? targetFrame.sections.find((s) => s.id === f.targetSectionId) : undefined;
  return (
    <Popover trigger={<span className={`badge ${f.type === "dependency" ? "badge-dep" : ""}`}>{label}</span>} kind={kind} title={`${title}(判定結果)`}>
      {(close) => (
        <div className="pop-body">
          {f.type === "crossing" && targetFrame && (
            <p>
              このカードは <b>{targetFrame.name}</b>
              {targetSec ? ` > ${targetSec.name}` : ""} のスコープに該当します。
            </p>
          )}
          {f.type !== "crossing" && other && (
            <p>
              相手: <b>{other.text}</b>
            </p>
          )}
          <p className="reason">{f.reason}</p>
          <div className="pop-actions">
            {f.type === "crossing" && (
              <button className="primary" onClick={() => cmd("flag_resolve", { flagId: f.id, action: "move" }).then(close)}>
                {targetFrame?.name}
                {targetSec ? ` > ${targetSec.name}` : ""} へ移動
              </button>
            )}
            {f.type === "duplicate" && (
              <>
                <button className="primary" onClick={() => cmd("flag_resolve", { flagId: f.id, action: "merge", keep: isSource ? "target" : "card" }).then(close)}>
                  統合(このカードを削除、相手を残す)
                </button>
                <button onClick={() => cmd("flag_resolve", { flagId: f.id, action: "merge", keep: isSource ? "card" : "target" }).then(close)}>
                  統合(相手を削除、このカードを残す)
                </button>
              </>
            )}
            {f.type === "dependency" && (
              <button onClick={() => cmd("flag_resolve", { flagId: f.id, action: "resolve" }).then(close)}>
                確認済みにする(線を消す)
              </button>
            )}
            <button onClick={() => cmd("flag_resolve", { flagId: f.id, action: "dismiss" }).then(close)}>別物として却下(再警告しない)</button>
          </div>
        </div>
      )}
    </Popover>
  );
}

// ---------- gaps (ghosts) ----------
function GhostCard({ g, ctx }: { g: Gap; ctx: Ctx }) {
  return (
    <div className="card ghost">
      <span className="ghost-tag">モレ候補</span>
      <p className="card-text">未検討: {g.title}</p>
      <p className="ghost-reason">{g.reason}</p>
      <div className="ghost-actions">
        <button className="adopt" onClick={() => ctx.cmd("gap_resolve", { gapId: g.id, action: "adopt" })}>
          採用
        </button>
        <button onClick={() => ctx.cmd("gap_resolve", { gapId: g.id, action: "dismiss" })}>不要</button>
      </div>
    </div>
  );
}
function GhostFrame({ g, ctx }: { g: Gap; ctx: Ctx }) {
  return (
    <div className="frame ghost">
      <div className="frame-head">
        <span className="ghost-tag">モレ候補(ボード)</span>
        <div className="frame-title-row">
          <span className="frame-name">{g.title}</span>
        </div>
        <p className="ghost-reason">{g.reason}</p>
        <div className="ghost-actions">
          <button className="adopt" onClick={() => ctx.cmd("gap_resolve", { gapId: g.id, action: "adopt" })}>
            大項目として採用
          </button>
          <button onClick={() => ctx.cmd("gap_resolve", { gapId: g.id, action: "dismiss" })}>不要</button>
        </div>
      </div>
    </div>
  );
}

export { ConfirmButton };
