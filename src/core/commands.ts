/**
 * コマンド層。UI(REST) も MCP もここを通す。
 * すべて Board を受け取って破壊的に更新し、結果を返す。永続化は呼び出し側(store.save)。
 */
import { randomBytes } from "node:crypto";
import {
  CARD_STATUSES,
  isStale,
  type Board,
  type Card,
  type CardStatus,
  type Dismissal,
  type Flag,
  type FlagType,
  type Frame,
  type Gap,
  type Note,
  type Section,
  type SubTask,
  type Task,
  type TodoGroup,
} from "./types.js";

export const now = (): string => new Date().toISOString();
export const newId = (prefix: string): string => `${prefix}_${randomBytes(5).toString("base64url")}`;

export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandError";
  }
}
const fail = (msg: string): never => {
  throw new CommandError(msg);
};

// ---------- lookup helpers ----------
export const getFrame = (b: Board, id: string): Frame => b.frames.find((f) => f.id === id) ?? fail(`frame not found: ${id}`);
export const getCard = (b: Board, id: string): Card => b.cards.find((c) => c.id === id) ?? fail(`card not found: ${id}`);
export const getNote = (b: Board, id: string): Note => b.notes.find((n) => n.id === id) ?? fail(`note not found: ${id}`);
export const getFlag = (b: Board, id: string): Flag => b.flags.find((f) => f.id === id) ?? fail(`flag not found: ${id}`);
export const getGap = (b: Board, id: string): Gap => b.gaps.find((g) => g.id === id) ?? fail(`gap not found: ${id}`);
export const getGroup = (b: Board, id: string): TodoGroup =>
  b.todoGroups.find((g) => g.id === id) ?? fail(`todo group not found: ${id}`);

function touch(b: Board): void {
  b.updatedAt = now();
}

function assertLocation(b: Board, frameId: string | null, sectionId: string | null): void {
  if (frameId === null) {
    if (sectionId !== null) fail("sectionId requires frameId");
    return;
  }
  const f = getFrame(b, frameId);
  if (sectionId !== null && !f.sections.some((s) => s.id === sectionId)) {
    fail(`section ${sectionId} not in frame ${frameId}`);
  }
}

// ---------- board ----------
export function createBoard(id: string, title: string): Board {
  const t = now();
  return {
    version: 1,
    id,
    title,
    frames: [],
    cards: [],
    notes: [],
    flags: [],
    gaps: [],
    todoGroups: [],
    dismissals: [],
    createdAt: t,
    updatedAt: t,
  };
}

export function setTitle(b: Board, title: string): void {
  b.title = title.trim() || fail("title must not be empty");
  touch(b);
}

// ---------- frame / section ----------
export function createFrame(b: Board, name: string, scopeText?: string): Frame {
  const n = name.trim() || fail("frame name must not be empty");
  if (b.frames.some((f) => f.name === n)) fail(`frame already exists: ${n}`);
  const t = now();
  const f: Frame = {
    id: newId("fr"),
    name: n,
    scope: scopeText?.trim() ? { text: scopeText.trim(), status: "draft" } : { text: "", status: "none" },
    sections: [],
    createdAt: t,
    updatedAt: t,
  };
  b.frames.push(f);
  touch(b);
  return f;
}

export function updateFrame(b: Board, id: string, patch: { name?: string; scopeText?: string }): Frame {
  const f = getFrame(b, id);
  if (patch.name !== undefined) {
    const n = patch.name.trim() || fail("frame name must not be empty");
    if (b.frames.some((x) => x.id !== id && x.name === n)) fail(`frame already exists: ${n}`);
    f.name = n;
  }
  if (patch.scopeText !== undefined) {
    const s = patch.scopeText.trim();
    // 定義文を変えたら承認は取り消し(草案に戻る)。判定基準が変わるので配下カードは再判定待ちに
    f.scope = s ? { text: s, status: "draft" } : { text: "", status: "none" };
    for (const c of b.cards) if (c.frameId === id) c.judgedAt = null;
  }
  f.updatedAt = now();
  touch(b);
  return f;
}

export function approveScope(b: Board, id: string): Frame {
  const f = getFrame(b, id);
  if (!f.scope.text) fail("scope text is empty; set it before approving");
  f.scope.status = "approved";
  f.updatedAt = now();
  touch(b);
  return f;
}

/** フレーム削除: 配下カードは未分類へ。セクションは消える */
export function deleteFrame(b: Board, id: string): { movedCardIds: string[] } {
  getFrame(b, id);
  const moved: string[] = [];
  for (const c of b.cards) {
    if (c.frameId === id) {
      c.frameId = null;
      c.sectionId = null;
      c.updatedAt = now();
      moved.push(c.id);
    }
  }
  b.frames = b.frames.filter((f) => f.id !== id);
  for (const fl of b.flags) {
    if (fl.status === "open" && fl.targetFrameId === id) {
      fl.status = "resolved";
      fl.resolvedAt = now();
    }
  }
  for (const g of b.gaps) {
    if (g.status === "open" && g.frameId === id) {
      g.status = "dismissed";
      g.resolvedAt = now();
    }
  }
  touch(b);
  return { movedCardIds: moved };
}

export function createSection(b: Board, frameId: string, name: string): Section {
  const f = getFrame(b, frameId);
  const n = name.trim() || fail("section name must not be empty");
  if (f.sections.some((s) => s.name === n)) fail(`section already exists in frame: ${n}`);
  const s: Section = { id: newId("sc"), name: n, createdAt: now() };
  f.sections.push(s);
  f.updatedAt = now();
  touch(b);
  return s;
}

export function renameSection(b: Board, frameId: string, sectionId: string, name: string): Section {
  const f = getFrame(b, frameId);
  const s = f.sections.find((x) => x.id === sectionId) ?? fail(`section not found: ${sectionId}`);
  s.name = name.trim() || fail("section name must not be empty");
  touch(b);
  return s;
}

/** セクション削除: 配下カードはフレーム直下へ */
export function deleteSection(b: Board, frameId: string, sectionId: string): { movedCardIds: string[] } {
  const f = getFrame(b, frameId);
  if (!f.sections.some((s) => s.id === sectionId)) fail(`section not found: ${sectionId}`);
  const moved: string[] = [];
  for (const c of b.cards) {
    if (c.sectionId === sectionId) {
      c.sectionId = null;
      moved.push(c.id);
    }
  }
  f.sections = f.sections.filter((s) => s.id !== sectionId);
  touch(b);
  return { movedCardIds: moved };
}

// ---------- card ----------
export function createCard(
  b: Board,
  text: string,
  opts: { frameId?: string | null; sectionId?: string | null; status?: CardStatus; noteIds?: string[] } = {},
): Card {
  const tx = text.trim() || fail("card text must not be empty");
  const frameId = opts.frameId ?? null;
  const sectionId = opts.sectionId ?? null;
  assertLocation(b, frameId, sectionId);
  const status = opts.status ?? "論点候補";
  if (!CARD_STATUSES.includes(status)) fail(`invalid status: ${status}`);
  const t = now();
  const c: Card = {
    id: newId("cd"),
    text: tx,
    status,
    frameId,
    sectionId,
    noteIds: [],
    createdAt: t,
    updatedAt: t,
    judgedAt: null, // 新規カードは未判定 = 再判定待ち
  };
  b.cards.push(c);
  for (const nid of opts.noteIds ?? []) linkNote(b, nid, c.id);
  touch(b);
  return c;
}

export function updateCard(b: Board, id: string, patch: { text?: string; status?: CardStatus }): Card {
  const c = getCard(b, id);
  let contentChanged = false;
  if (patch.text !== undefined) {
    const tx = patch.text.trim() || fail("card text must not be empty");
    if (tx !== c.text) {
      c.text = tx;
      contentChanged = true;
    }
  }
  if (patch.status !== undefined) {
    if (!CARD_STATUSES.includes(patch.status)) fail(`invalid status: ${patch.status}`);
    c.status = patch.status;
  }
  c.updatedAt = now();
  // 本文が変わった時だけ再判定待ちにする(ステータス変更は判定に影響しない)
  if (contentChanged) c.judgedAt = null;
  else if (c.judgedAt !== null) c.judgedAt = c.updatedAt;
  touch(b);
  return c;
}

export function moveCard(b: Board, id: string, frameId: string | null, sectionId: string | null): Card {
  const c = getCard(b, id);
  assertLocation(b, frameId, sectionId);
  c.frameId = frameId;
  c.sectionId = sectionId;
  c.updatedAt = now();
  // 移動先が変わると越境判定の前提が変わるので再判定待ちに。ただし open な crossing フラグの提案先へ移動した場合は resolveFlag 側で扱う
  c.judgedAt = null;
  touch(b);
  return c;
}

/** カード削除の連鎖: 刺さっている線(flags)は閉じる、出所メモは未反映に戻る、TODO グループは残す */
export function deleteCard(b: Board, id: string): { unlinkedNoteIds: string[]; orphanedGroupIds: string[]; closedFlagIds: string[] } {
  getCard(b, id);
  const unlinkedNoteIds: string[] = [];
  for (const n of b.notes) {
    if (n.cardId === id) {
      n.cardId = null;
      n.updatedAt = now();
      unlinkedNoteIds.push(n.id);
    }
  }
  const closedFlagIds: string[] = [];
  for (const fl of b.flags) {
    if (fl.status === "open" && (fl.cardId === id || fl.targetCardId === id)) {
      fl.status = "resolved";
      fl.resolvedAt = now();
      closedFlagIds.push(fl.id);
    }
  }
  const orphanedGroupIds = b.todoGroups.filter((g) => g.cardId === id).map((g) => g.id);
  b.cards = b.cards.filter((c) => c.id !== id);
  touch(b);
  return { unlinkedNoteIds, orphanedGroupIds, closedFlagIds };
}

// ---------- note ----------
export function addNotes(b: Board, texts: string[]): Note[] {
  const out: Note[] = [];
  for (const raw of texts) {
    const tx = raw.trim();
    if (!tx) continue;
    const t = now();
    const n: Note = { id: newId("nt"), text: tx, cardId: null, createdAt: t, updatedAt: t };
    b.notes.push(n);
    out.push(n);
  }
  if (out.length) touch(b);
  return out;
}

export function updateNote(b: Board, id: string, text: string): Note {
  const n = getNote(b, id);
  n.text = text.trim() || fail("note text must not be empty");
  n.updatedAt = now();
  touch(b);
  return n;
}

/** メモ削除: カードは残る(出所メモなしになるだけ) */
export function deleteNote(b: Board, id: string): { cardId: string | null } {
  const n = getNote(b, id);
  if (n.cardId) {
    const c = b.cards.find((x) => x.id === n.cardId);
    if (c) c.noteIds = c.noteIds.filter((x) => x !== id);
  }
  b.notes = b.notes.filter((x) => x.id !== id);
  touch(b);
  return { cardId: n.cardId };
}

export function linkNote(b: Board, noteId: string, cardId: string): void {
  const n = getNote(b, noteId);
  const c = getCard(b, cardId);
  if (n.cardId && n.cardId !== cardId) {
    const prev = b.cards.find((x) => x.id === n.cardId);
    if (prev) prev.noteIds = prev.noteIds.filter((x) => x !== noteId);
  }
  n.cardId = cardId;
  n.updatedAt = now();
  if (!c.noteIds.includes(noteId)) c.noteIds.push(noteId);
  touch(b);
}

/** メモをカード化(本文はメモから複製。以後は独立して編集できる) */
export function noteToCard(
  b: Board,
  noteId: string,
  opts: { frameId?: string | null; sectionId?: string | null; text?: string; status?: CardStatus } = {},
): Card {
  const n = getNote(b, noteId);
  if (n.cardId && b.cards.some((c) => c.id === n.cardId)) fail(`note already linked to card ${n.cardId}`);
  return createCard(b, opts.text ?? n.text, { ...opts, noteIds: [noteId] });
}

// ---------- MECE: material / report / resolve ----------
export interface MeceMaterial {
  boardId: string;
  title: string;
  frames: {
    id: string;
    name: string;
    scope: Frame["scope"];
    sections: { id: string; name: string }[];
    cards: { id: string; sectionId: string | null; text: string; status: CardStatus; stale: boolean }[];
  }[];
  unassigned: { id: string; text: string; status: CardStatus; stale: boolean }[];
  staleCardIds: string[];
  openFlags: Flag[];
  openGaps: Gap[];
  dismissals: Dismissal[];
  instructions: string;
}

export function meceMaterial(b: Board): MeceMaterial {
  const frames = b.frames.map((f) => ({
    id: f.id,
    name: f.name,
    scope: f.scope,
    sections: f.sections.map((s) => ({ id: s.id, name: s.name })),
    cards: b.cards
      .filter((c) => c.frameId === f.id)
      .map((c) => ({ id: c.id, sectionId: c.sectionId, text: c.text, status: c.status, stale: isStale(c) })),
  }));
  const unassigned = b.cards
    .filter((c) => c.frameId === null)
    .map((c) => ({ id: c.id, text: c.text, status: c.status, stale: isStale(c) }));
  return {
    boardId: b.id,
    title: b.title,
    frames,
    unassigned,
    staleCardIds: b.cards.filter(isStale).map((c) => c.id),
    openFlags: b.flags.filter((f) => f.status === "open"),
    openGaps: b.gaps.filter((g) => g.status === "open"),
    dismissals: b.dismissals,
    instructions: [
      "あなた(呼び出し側モデル)が判定者です。以下を判定し、mece_report で書き戻してください。",
      "1) crossing: カードが、承認済み(scope.status=approved)の別フレームのスコープに該当する。targetFrameId(+任意でtargetSectionId)を付ける。",
      "2) duplicate: 2枚のカードがほぼ同一の論点。cardId/targetCardId の順序は問わない。",
      "3) dependency: 前提関係(MECE違反ではない)。過剰に付けない。",
      "4) gap: トップイシュー(title)に答えるのに必要だがどのフレームにもない大項目(level=board)、または承認済みスコープに対して未検討の論点(level=frame)。",
      "判定対象は staleCardIds を優先。dismissals にある組み合わせは再警告しない。openFlags/openGaps と重複する報告は不要。",
      "judgedCardIds には判定を済ませたカード(stale か否かを問わず)をすべて含める。",
    ].join("\n"),
  };
}

export interface FlagInput {
  type: FlagType;
  cardId: string;
  targetCardId?: string | null;
  targetFrameId?: string | null;
  targetSectionId?: string | null;
  reason: string;
}
export interface GapInput {
  level: "board" | "frame";
  frameId?: string | null;
  title: string;
  reason: string;
}

function flagKey(f: { type: FlagType; cardId: string; targetCardId?: string | null; targetFrameId?: string | null }): string {
  if (f.type === "crossing") return `crossing:${f.cardId}:${f.targetFrameId ?? ""}`;
  const pair = [f.cardId, f.targetCardId ?? ""].sort();
  return `${f.type}:${pair[0]}:${pair[1]}`;
}
const gapKey = (g: { level: string; frameId?: string | null; title: string }): string =>
  `gap:${g.level}:${g.frameId ?? ""}:${g.title.trim().toLowerCase()}`;

/** 判定結果の書き戻し。dismissals / 既存 open と重複するものは捨てる */
export function reportJudgment(
  b: Board,
  input: { flags?: FlagInput[]; gaps?: GapInput[]; judgedCardIds?: string[] },
): { addedFlags: Flag[]; addedGaps: Gap[]; skipped: string[]; judgedCount: number } {
  const t = now();
  const addedFlags: Flag[] = [];
  const addedGaps: Gap[] = [];
  const skipped: string[] = [];
  const dismissed = new Set(b.dismissals.map((d) => d.key));
  const openKeys = new Set(b.flags.filter((f) => f.status === "open").map(flagKey));

  for (const fi of input.flags ?? []) {
    getCard(b, fi.cardId);
    if (fi.type === "crossing") {
      if (!fi.targetFrameId) {
        skipped.push(`crossing without targetFrameId (${fi.cardId})`);
        continue;
      }
      const tf = getFrame(b, fi.targetFrameId);
      if (fi.targetSectionId && !tf.sections.some((s) => s.id === fi.targetSectionId)) {
        skipped.push(`section ${fi.targetSectionId} not in ${fi.targetFrameId}`);
        continue;
      }
      const card = getCard(b, fi.cardId);
      if (card.frameId === fi.targetFrameId) {
        skipped.push(`crossing target equals current frame (${fi.cardId})`);
        continue;
      }
    } else {
      if (!fi.targetCardId || fi.targetCardId === fi.cardId) {
        skipped.push(`${fi.type} needs a different targetCardId (${fi.cardId})`);
        continue;
      }
      getCard(b, fi.targetCardId);
    }
    const key = flagKey(fi);
    if (dismissed.has(key)) {
      skipped.push(`dismissed: ${key}`);
      continue;
    }
    if (openKeys.has(key)) {
      skipped.push(`already open: ${key}`);
      continue;
    }
    openKeys.add(key);
    const fl: Flag = {
      id: newId("fg"),
      type: fi.type,
      cardId: fi.cardId,
      targetCardId: fi.targetCardId ?? null,
      targetFrameId: fi.targetFrameId ?? null,
      targetSectionId: fi.targetSectionId ?? null,
      reason: fi.reason.trim(),
      status: "open",
      createdAt: t,
      resolvedAt: null,
    };
    b.flags.push(fl);
    addedFlags.push(fl);
  }

  const openGapKeys = new Set(b.gaps.filter((g) => g.status === "open").map(gapKey));
  for (const gi of input.gaps ?? []) {
    if (gi.level === "frame") {
      if (!gi.frameId) {
        skipped.push(`frame gap without frameId (${gi.title})`);
        continue;
      }
      getFrame(b, gi.frameId);
    }
    const key = gapKey(gi);
    if (dismissed.has(key)) {
      skipped.push(`dismissed: ${key}`);
      continue;
    }
    if (openGapKeys.has(key)) {
      skipped.push(`already open: ${key}`);
      continue;
    }
    openGapKeys.add(key);
    const g: Gap = {
      id: newId("gp"),
      level: gi.level,
      frameId: gi.level === "frame" ? (gi.frameId ?? null) : null,
      title: gi.title.trim(),
      reason: gi.reason.trim(),
      status: "open",
      createdAt: t,
      resolvedAt: null,
    };
    b.gaps.push(g);
    addedGaps.push(g);
  }

  let judgedCount = 0;
  for (const id of input.judgedCardIds ?? []) {
    const c = b.cards.find((x) => x.id === id);
    if (c) {
      c.judgedAt = t;
      judgedCount++;
    }
  }
  touch(b);
  return { addedFlags, addedGaps, skipped, judgedCount };
}

export type FlagResolution =
  | { action: "move" } // crossing: 提案先へ移動
  | { action: "merge"; keep?: "card" | "target" } // duplicate: 片方を削除(既定は cardId 側を削除して target を残す)
  | { action: "dismiss" } // 別物として却下(再警告しない)
  | { action: "resolve" }; // 手動で対応済み

export function resolveFlag(b: Board, id: string, res: FlagResolution): { flag: Flag; deletedCardId?: string; movedCardId?: string } {
  const fl = getFlag(b, id);
  if (fl.status !== "open") fail(`flag is not open: ${id}`);
  const t = now();
  const out: { flag: Flag; deletedCardId?: string; movedCardId?: string } = { flag: fl };
  switch (res.action) {
    case "move": {
      if (fl.type !== "crossing" || !fl.targetFrameId) fail("move is only for crossing flags");
      const c = getCard(b, fl.cardId);
      c.frameId = fl.targetFrameId;
      c.sectionId = fl.targetSectionId;
      c.updatedAt = t;
      c.judgedAt = t; // 判定に従って移動したので最新扱い
      out.movedCardId = c.id;
      break;
    }
    case "merge": {
      if (fl.type !== "duplicate" || !fl.targetCardId) return fail("merge is only for duplicate flags");
      const targetId: string = fl.targetCardId;
      const removeId = res.keep === "card" ? targetId : fl.cardId;
      const keepId = removeId === fl.cardId ? targetId : fl.cardId;
      const removed = getCard(b, removeId);
      const kept = getCard(b, keepId);
      // 出所メモは残す側に付け替える
      for (const nid of removed.noteIds) linkNote(b, nid, kept.id);
      deleteCard(b, removeId);
      out.deletedCardId = removeId;
      break;
    }
    case "dismiss": {
      b.dismissals.push({ type: fl.type, key: flagKey(fl), at: t });
      fl.status = "dismissed";
      fl.resolvedAt = t;
      touch(b);
      return out;
    }
    case "resolve":
      break;
  }
  fl.status = "resolved";
  fl.resolvedAt = t;
  touch(b);
  return out;
}

export type GapResolution =
  | { action: "adopt"; as?: "card" | "frame"; text?: string; frameId?: string | null; sectionId?: string | null }
  | { action: "dismiss" };

export function resolveGap(b: Board, id: string, res: GapResolution): { gap: Gap; card?: Card; frame?: Frame } {
  const g = getGap(b, id);
  if (g.status !== "open") fail(`gap is not open: ${id}`);
  const t = now();
  const out: { gap: Gap; card?: Card; frame?: Frame } = { gap: g };
  if (res.action === "dismiss") {
    b.dismissals.push({ type: "gap", key: gapKey(g), at: t });
    g.status = "dismissed";
    g.resolvedAt = t;
    touch(b);
    return out;
  }
  const as = res.as ?? (g.level === "board" ? "frame" : "card");
  if (as === "frame") {
    out.frame = createFrame(b, res.text ?? g.title, g.reason);
  } else {
    const frameId = res.frameId === undefined ? g.frameId : res.frameId;
    out.card = createCard(b, res.text ?? g.title, { frameId, sectionId: res.sectionId ?? null });
  }
  g.status = "adopted";
  g.resolvedAt = t;
  touch(b);
  return out;
}

// ---------- todo ----------
export function createTodoGroup(b: Board, cardId: string, title?: string): TodoGroup {
  const c = getCard(b, cardId);
  if (b.todoGroups.some((g) => g.cardId === cardId)) fail(`todo group already exists for card ${cardId}`);
  const t = now();
  const g: TodoGroup = { id: newId("tg"), cardId, title: (title ?? c.text).trim(), tasks: [], createdAt: t, updatedAt: t };
  b.todoGroups.push(g);
  touch(b);
  return g;
}

export function updateTodoGroup(b: Board, id: string, patch: { title?: string; cardId?: string }): TodoGroup {
  const g = getGroup(b, id);
  if (patch.title !== undefined) g.title = patch.title.trim() || fail("title must not be empty");
  if (patch.cardId !== undefined) {
    getCard(b, patch.cardId);
    g.cardId = patch.cardId; // 孤児グループの付け替え
  }
  g.updatedAt = now();
  touch(b);
  return g;
}

export function deleteTodoGroup(b: Board, id: string): void {
  getGroup(b, id);
  b.todoGroups = b.todoGroups.filter((g) => g.id !== id);
  touch(b);
}

export function addTask(b: Board, groupId: string, text: string, parentTaskId?: string | null): Task | SubTask {
  const g = getGroup(b, groupId);
  const tx = text.trim() || fail("task text must not be empty");
  let created: Task | SubTask;
  if (parentTaskId) {
    const p = g.tasks.find((t) => t.id === parentTaskId) ?? fail(`task not found: ${parentTaskId}`);
    const s: SubTask = { id: newId("st"), text: tx, done: false };
    p.subs.push(s);
    if (p.done) p.done = false; // 未完のサブタスクが増えたら親は未完
    created = s;
  } else {
    const t: Task = { id: newId("tk"), text: tx, done: false, subs: [] };
    g.tasks.push(t);
    created = t;
  }
  g.updatedAt = now();
  touch(b);
  return created;
}

function findTask(g: TodoGroup, taskId: string): { task: Task | SubTask; parent: Task | null } {
  for (const t of g.tasks) {
    if (t.id === taskId) return { task: t, parent: null };
    for (const s of t.subs) if (s.id === taskId) return { task: s, parent: t };
  }
  return fail(`task not found: ${taskId}`);
}

export function updateTask(b: Board, groupId: string, taskId: string, patch: { text?: string; done?: boolean }): Task | SubTask {
  const g = getGroup(b, groupId);
  const { task, parent } = findTask(g, taskId);
  if (patch.text !== undefined) task.text = patch.text.trim() || fail("task text must not be empty");
  if (patch.done !== undefined) {
    task.done = patch.done;
    if (parent === null && patch.done) for (const s of (task as Task).subs) s.done = true; // 親完了→子も完了
    if (parent !== null && !patch.done) parent.done = false; // 子未完→親未完
  }
  g.updatedAt = now();
  touch(b);
  return task;
}

export function deleteTask(b: Board, groupId: string, taskId: string): void {
  const g = getGroup(b, groupId);
  const { parent } = findTask(g, taskId);
  if (parent) parent.subs = parent.subs.filter((s) => s.id !== taskId);
  else g.tasks = g.tasks.filter((t) => t.id !== taskId);
  g.updatedAt = now();
  touch(b);
}

// ---------- summary ----------
export interface Summary {
  boardId: string;
  title: string;
  frames: { id: string; name: string; scopeStatus: Frame["scope"]["status"]; cards: number; concluded: number; sections: number }[];
  unassignedCards: number;
  staleCards: number;
  openFlags: { crossing: number; duplicate: number; dependency: number };
  openGaps: number;
  notes: { total: number; pending: number };
  concludedWithoutTodo: { cardId: string; text: string }[];
  todo: { groups: number; orphanGroups: number; done: number; total: number };
}

export function summary(b: Board): Summary {
  const cardIds = new Set(b.cards.map((c) => c.id));
  const grouped = new Set(b.todoGroups.map((g) => g.cardId));
  let done = 0,
    total = 0;
  for (const g of b.todoGroups)
    for (const t of g.tasks) {
      total++;
      if (t.done) done++;
      for (const s of t.subs) {
        total++;
        if (s.done) done++;
      }
    }
  const open = b.flags.filter((f) => f.status === "open");
  return {
    boardId: b.id,
    title: b.title,
    frames: b.frames.map((f) => {
      const cs = b.cards.filter((c) => c.frameId === f.id);
      return {
        id: f.id,
        name: f.name,
        scopeStatus: f.scope.status,
        cards: cs.length,
        concluded: cs.filter((c) => c.status === "結論").length,
        sections: f.sections.length,
      };
    }),
    unassignedCards: b.cards.filter((c) => c.frameId === null).length,
    staleCards: b.cards.filter(isStale).length,
    openFlags: {
      crossing: open.filter((f) => f.type === "crossing").length,
      duplicate: open.filter((f) => f.type === "duplicate").length,
      dependency: open.filter((f) => f.type === "dependency").length,
    },
    openGaps: b.gaps.filter((g) => g.status === "open").length,
    notes: { total: b.notes.length, pending: b.notes.filter((n) => !n.cardId || !cardIds.has(n.cardId)).length },
    concludedWithoutTodo: b.cards.filter((c) => c.status === "結論" && !grouped.has(c.id)).map((c) => ({ cardId: c.id, text: c.text })),
    todo: {
      groups: b.todoGroups.length,
      orphanGroups: b.todoGroups.filter((g) => !cardIds.has(g.cardId)).length,
      done,
      total,
    },
  };
}
