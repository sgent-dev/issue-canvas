#!/usr/bin/env node
/**
 * Issue Canvas MCP server (stdio)
 *
 * 判定(ダブり/モレ)は呼び出し側モデルが行う設計:
 *   mece_material で材料を取得 → モデルが判定 → mece_report で書き戻し
 * サーバー自身は LLM API を呼ばない(コストゼロ)。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as C from "../core/commands.js";
import { JsonFileStore } from "../core/store.js";
import { CARD_STATUSES, type Board } from "../core/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.ISSUE_CANVAS_DATA ?? path.resolve(here, "..", "..", "data");
const store = new JsonFileStore(DATA_DIR);

const server = new McpServer({ name: "issue-canvas", version: "0.1.0" });

// ---------- helpers ----------
type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const ok = (data: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
const err = (e: unknown): ToolResult => ({
  content: [{ type: "text", text: `error: ${e instanceof Error ? e.message : String(e)}` }],
  isError: true,
});

async function withBoard<T>(boardId: string, fn: (b: Board) => T | Promise<T>): Promise<ToolResult> {
  try {
    const b = await store.load(boardId);
    const result = await fn(b);
    await store.save(b);
    return ok(result);
  } catch (e) {
    return err(e);
  }
}
async function readBoard<T>(boardId: string, fn: (b: Board) => T): Promise<ToolResult> {
  try {
    return ok(fn(await store.load(boardId)));
  } catch (e) {
    return err(e);
  }
}

const boardId = z.string().describe("ボードID (board_list で取得)");
const status = z.enum(CARD_STATUSES as [string, ...string[]]).describe("カードのステータス: 論点候補 / イシュー化 / 仮説あり / 結論");
const nullableId = (d: string) => z.string().nullable().optional().describe(d);

// ---------- board ----------
server.registerTool(
  "board_list",
  { title: "ボード一覧", description: "保存されているボードの一覧(id, title, updatedAt)。", inputSchema: {} },
  async () => {
    try {
      return ok(await store.list());
    } catch (e) {
      return err(e);
    }
  },
);

server.registerTool(
  "board_create",
  {
    title: "ボード作成",
    description: "新しいボードを作る。title はトップイシュー(答えを出したい問い)。id は英数字・-・_。",
    inputSchema: { id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), title: z.string() },
  },
  async ({ id, title }) => {
    try {
      if (await store.exists(id)) return err(new Error(`board already exists: ${id}`));
      const b = C.createBoard(id, title);
      await store.save(b);
      return ok(C.summary(b));
    } catch (e) {
      return err(e);
    }
  },
);

server.registerTool(
  "board_get",
  {
    title: "ボード取得",
    description:
      "ボードの内容を返す。view=summary(既定): 件数サマリ(再判定待ち・未反映メモ・open警告・TODO化されていない結論など)。view=full: 全データ。作業前にまず summary を見て状態を把握すること。",
    inputSchema: { boardId, view: z.enum(["summary", "full"]).optional() },
  },
  async ({ boardId: id, view }) => readBoard(id, (b) => (view === "full" ? b : C.summary(b))),
);

server.registerTool(
  "board_set_title",
  { title: "トップイシュー変更", description: "ボードのトップイシュー(問い)を変更する。", inputSchema: { boardId, title: z.string() } },
  async ({ boardId: id, title }) => withBoard(id, (b) => (C.setTitle(b, title), C.summary(b))),
);

// ---------- frame / section ----------
server.registerTool(
  "frame_create",
  {
    title: "大項目(フレーム)作成",
    description:
      "大項目を作る。scopeText を渡すと草案(draft)として保存される(frame_approve_scope で承認するまで判定基準にならない)。名前だけで作ってよい。",
    inputSchema: { boardId, name: z.string(), scopeText: z.string().optional() },
  },
  async ({ boardId: id, name, scopeText }) => withBoard(id, (b) => C.createFrame(b, name, scopeText)),
);

server.registerTool(
  "frame_update",
  {
    title: "大項目の更新",
    description:
      "名前またはスコープ定義文を更新。scopeText を変えると承認は取り消されて草案に戻り、配下カードは再判定待ちになる。",
    inputSchema: { boardId, frameId: z.string(), name: z.string().optional(), scopeText: z.string().optional() },
  },
  async ({ boardId: id, frameId, name, scopeText }) => withBoard(id, (b) => C.updateFrame(b, frameId, { name, scopeText })),
);

server.registerTool(
  "frame_approve_scope",
  {
    title: "スコープ定義を承認",
    description: "スコープ定義を承認する。承認済みフレームだけが越境(crossing)/モレ(gap)判定の基準になる。ユーザーの承認を得てから呼ぶこと。",
    inputSchema: { boardId, frameId: z.string() },
  },
  async ({ boardId: id, frameId }) => withBoard(id, (b) => C.approveScope(b, frameId)),
);

server.registerTool(
  "frame_delete",
  {
    title: "大項目の削除",
    description: "大項目を削除。配下カードは未分類へ移り、セクションは消える。破壊的操作なのでユーザー確認の上で。",
    inputSchema: { boardId, frameId: z.string() },
  },
  async ({ boardId: id, frameId }) => withBoard(id, (b) => C.deleteFrame(b, frameId)),
);

server.registerTool(
  "section_create",
  {
    title: "中項目(セクション)作成",
    description: "フレーム内に中項目を作る。2層で足りるなら作らなくてよい(カードはフレーム直下に置ける)。",
    inputSchema: { boardId, frameId: z.string(), name: z.string() },
  },
  async ({ boardId: id, frameId, name }) => withBoard(id, (b) => C.createSection(b, frameId, name)),
);

server.registerTool(
  "section_delete",
  {
    title: "中項目の削除",
    description: "中項目を削除。配下カードはフレーム直下へ移る。",
    inputSchema: { boardId, frameId: z.string(), sectionId: z.string() },
  },
  async ({ boardId: id, frameId, sectionId }) => withBoard(id, (b) => C.deleteSection(b, frameId, sectionId)),
);

// ---------- card ----------
server.registerTool(
  "card_create",
  {
    title: "カード作成",
    description:
      "検討内容(論点)のカードを作る。frameId 省略で未分類。新規カードは再判定待ち(judgedAt=null)になる。メモから起こす場合は note_to_card を使うこと(出所リンクが付く)。",
    inputSchema: {
      boardId,
      text: z.string(),
      frameId: nullableId("配置先フレーム。null/省略で未分類"),
      sectionId: nullableId("配置先セクション(frameId 必須)"),
      status: status.optional(),
    },
  },
  async ({ boardId: id, text, frameId, sectionId, status: st }) =>
    withBoard(id, (b) => C.createCard(b, text, { frameId, sectionId, status: st as never })),
);

server.registerTool(
  "card_update",
  {
    title: "カード更新",
    description: "本文/ステータスを更新。本文が変わると再判定待ちになる(ステータス変更だけならならない)。ID リンク(メモ/TODO/警告)は維持される。",
    inputSchema: { boardId, cardId: z.string(), text: z.string().optional(), status: status.optional() },
  },
  async ({ boardId: id, cardId, text, status: st }) => withBoard(id, (b) => C.updateCard(b, cardId, { text, status: st as never })),
);

server.registerTool(
  "card_move",
  {
    title: "カード移動",
    description: "カードを別のフレーム/セクション(または未分類)へ移す。移動後は再判定待ちになる。crossing フラグに従う移動は flag_resolve(action=move) を使うこと。",
    inputSchema: { boardId, cardId: z.string(), frameId: nullableId("移動先フレーム。null で未分類"), sectionId: nullableId("移動先セクション") },
  },
  async ({ boardId: id, cardId, frameId, sectionId }) => withBoard(id, (b) => C.moveCard(b, cardId, frameId ?? null, sectionId ?? null)),
);

server.registerTool(
  "card_delete",
  {
    title: "カード削除",
    description: "カードを削除。連鎖: 刺さっている警告は閉じる / 出所メモは未反映に戻る / TODO グループは残る(孤児として表示)。破壊的操作なのでユーザー確認の上で。",
    inputSchema: { boardId, cardId: z.string() },
  },
  async ({ boardId: id, cardId }) => withBoard(id, (b) => C.deleteCard(b, cardId)),
);

// ---------- note ----------
server.registerTool(
  "note_add",
  {
    title: "メモ追加",
    description:
      "会話で出た要件・気になること・疑問をそのままメモに入れる(1要素=1メモ)。整理はあとでカード化するので粒度は気にしなくてよい。ユーザーとの深掘り中に出た論点はこまめにここへ。",
    inputSchema: { boardId, texts: z.array(z.string()).min(1) },
  },
  async ({ boardId: id, texts }) => withBoard(id, (b) => C.addNotes(b, texts)),
);

server.registerTool(
  "note_update",
  { title: "メモ更新", description: "メモ本文を更新。紐づくカードは変えない(メモは出所の記録)。", inputSchema: { boardId, noteId: z.string(), text: z.string() } },
  async ({ boardId: id, noteId, text }) => withBoard(id, (b) => C.updateNote(b, noteId, text)),
);

server.registerTool(
  "note_delete",
  { title: "メモ削除", description: "メモを削除。カード化済みならカードは残る(出所なしになるだけ)。", inputSchema: { boardId, noteId: z.string() } },
  async ({ boardId: id, noteId }) => withBoard(id, (b) => C.deleteNote(b, noteId)),
);

server.registerTool(
  "note_to_card",
  {
    title: "メモをカード化",
    description:
      "未反映メモからカードを作る(出所リンク付き)。配置先は承認済みスコープと照合して決める。該当なしなら frameId 省略で未分類へ。text で本文を整えてもよい。",
    inputSchema: {
      boardId,
      noteId: z.string(),
      frameId: nullableId("配置先フレーム。省略で未分類"),
      sectionId: nullableId("配置先セクション"),
      text: z.string().optional().describe("カード本文(省略時はメモ本文)"),
      status: status.optional(),
    },
  },
  async ({ boardId: id, noteId, frameId, sectionId, text, status: st }) =>
    withBoard(id, (b) => C.noteToCard(b, noteId, { frameId, sectionId, text, status: st as never })),
);

// ---------- MECE ----------
server.registerTool(
  "mece_material",
  {
    title: "MECE判定の材料を取得",
    description:
      "ダブり(越境/重複)・モレ判定に必要な材料(トップイシュー、各フレームのスコープ定義と承認状態、全カード、再判定待ちカード、既存の open 警告、却下記録)を返す。判定はあなた(呼び出し側モデル)が行い、結果を mece_report で書き戻す。サーバーは LLM を呼ばない。",
    inputSchema: { boardId },
  },
  async ({ boardId: id }) => readBoard(id, C.meceMaterial),
);

const flagInput = z.object({
  type: z.enum(["crossing", "duplicate", "dependency"]),
  cardId: z.string(),
  targetCardId: z.string().nullable().optional().describe("duplicate/dependency の相手カード"),
  targetFrameId: z.string().nullable().optional().describe("crossing の本来属すべきフレーム"),
  targetSectionId: z.string().nullable().optional(),
  reason: z.string().describe("なぜそう判定したか(ユーザーに表示される)"),
});
const gapInput = z.object({
  level: z.enum(["board", "frame"]),
  frameId: z.string().nullable().optional().describe("level=frame のとき必須"),
  title: z.string().describe("欠けている論点/大項目の名前"),
  reason: z.string(),
});

server.registerTool(
  "mece_report",
  {
    title: "MECE判定結果の書き戻し",
    description:
      "判定結果を保存する。flags: crossing(越境)/duplicate(重複)/dependency(依存)。gaps: モレ候補。judgedCardIds: 判定を済ませたカード(再判定待ちが解消される)。却下済み・既に open のものは自動でスキップされる。",
    inputSchema: {
      boardId,
      flags: z.array(flagInput).optional(),
      gaps: z.array(gapInput).optional(),
      judgedCardIds: z.array(z.string()).optional(),
    },
  },
  async ({ boardId: id, flags, gaps, judgedCardIds }) => withBoard(id, (b) => C.reportJudgment(b, { flags, gaps, judgedCardIds })),
);

server.registerTool(
  "flag_resolve",
  {
    title: "警告の解決",
    description:
      "open な警告を処理する。move: crossing の提案先へ移動 / merge: duplicate の片方を削除(既定は cardId 側を削除、keep=card で target 側を削除。出所メモは残る側へ) / dismiss: 別物として却下(同じ組み合わせは再警告しない) / resolve: 手動対応済み。ユーザーの判断を確認してから呼ぶこと。",
    inputSchema: {
      boardId,
      flagId: z.string(),
      action: z.enum(["move", "merge", "dismiss", "resolve"]),
      keep: z.enum(["card", "target"]).optional(),
    },
  },
  async ({ boardId: id, flagId, action, keep }) =>
    withBoard(id, (b) => C.resolveFlag(b, flagId, action === "merge" ? { action, keep } : { action })),
);

server.registerTool(
  "gap_resolve",
  {
    title: "モレ候補の処理",
    description:
      "adopt: 採用(level=board は新フレーム、level=frame はそのフレーム内カードとして作成。as/text/frameId/sectionId で上書き可) / dismiss: 不要(同じ候補は再提示しない)。",
    inputSchema: {
      boardId,
      gapId: z.string(),
      action: z.enum(["adopt", "dismiss"]),
      as: z.enum(["card", "frame"]).optional(),
      text: z.string().optional(),
      frameId: z.string().nullable().optional(),
      sectionId: z.string().nullable().optional(),
    },
  },
  async ({ boardId: id, gapId, action, as, text, frameId, sectionId }) =>
    withBoard(id, (b) => C.resolveGap(b, gapId, action === "adopt" ? { action, as, text, frameId, sectionId } : { action })),
);

// ---------- todo ----------
server.registerTool(
  "todo_group_create",
  {
    title: "タスクグループ作成",
    description: "結論が出た要件カードに対して実装タスクのグループを作る(1カード1グループ)。title 省略でカード本文。",
    inputSchema: { boardId, cardId: z.string(), title: z.string().optional() },
  },
  async ({ boardId: id, cardId, title }) => withBoard(id, (b) => C.createTodoGroup(b, cardId, title)),
);

server.registerTool(
  "todo_group_update",
  {
    title: "タスクグループ更新",
    description: "タイトル変更、または cardId で要件カードの付け替え(孤児グループの救済)。",
    inputSchema: { boardId, groupId: z.string(), title: z.string().optional(), cardId: z.string().optional() },
  },
  async ({ boardId: id, groupId, title, cardId }) => withBoard(id, (b) => C.updateTodoGroup(b, groupId, { title, cardId })),
);

server.registerTool(
  "todo_group_delete",
  { title: "タスクグループ削除", description: "グループをタスクごと削除。要件カードには影響しない。", inputSchema: { boardId, groupId: z.string() } },
  async ({ boardId: id, groupId }) => withBoard(id, (b) => (C.deleteTodoGroup(b, groupId), { deleted: groupId })),
);

server.registerTool(
  "todo_task_add",
  {
    title: "タスク追加",
    description: "グループにタスクを追加。parentTaskId を渡すとそのタスクの細分化(サブタスク、1段のみ)。",
    inputSchema: { boardId, groupId: z.string(), text: z.string(), parentTaskId: z.string().nullable().optional() },
  },
  async ({ boardId: id, groupId, text, parentTaskId }) => withBoard(id, (b) => C.addTask(b, groupId, text, parentTaskId)),
);

server.registerTool(
  "todo_task_update",
  {
    title: "タスク更新",
    description: "本文/完了状態を更新。親を完了にすると子も完了、子を未完に戻すと親も未完になる。",
    inputSchema: { boardId, groupId: z.string(), taskId: z.string(), text: z.string().optional(), done: z.boolean().optional() },
  },
  async ({ boardId: id, groupId, taskId, text, done }) => withBoard(id, (b) => C.updateTask(b, groupId, taskId, { text, done })),
);

server.registerTool(
  "todo_task_delete",
  { title: "タスク削除", description: "タスク削除(親ならサブタスクごと)。", inputSchema: { boardId, groupId: z.string(), taskId: z.string() } },
  async ({ boardId: id, groupId, taskId }) => withBoard(id, (b) => (C.deleteTask(b, groupId, taskId), { deleted: taskId })),
);

// ---------- start ----------
async function main(): Promise<void> {
  await store.ensureDir();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[issue-canvas] MCP server ready (data: ${DATA_DIR})`);
}

main().catch((e) => {
  console.error("[issue-canvas] fatal:", e);
  process.exit(1);
});
