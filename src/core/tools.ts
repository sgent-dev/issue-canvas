/**
 * ツール定義レジストリ。MCP サーバーと REST API の両方がここを読む(定義は 1 か所)。
 * - scope "store": ストア全体に対する操作(board_list / board_create)
 * - scope "board": ボードを読み込み → 変更 → 保存
 * - scope "board-read": 読み取りのみ(保存しない)
 */
import { z } from "zod";
import * as C from "./commands.js";
import type { Store } from "./store.js";
import { CARD_STATUSES, type Board } from "./types.js";

export type Shape = z.ZodRawShape;

export type ToolDef =
  | { name: string; title: string; description: string; scope: "store"; schema: Shape; run: (store: Store, args: any) => Promise<unknown> }
  | { name: string; title: string; description: string; scope: "board" | "board-read"; schema: Shape; run: (b: Board, args: any) => unknown };

const status = z.enum(CARD_STATUSES as [string, ...string[]]).describe("カードのステータス: 論点候補 / イシュー化 / 仮説あり / 結論");
const nullableId = (d: string) => z.string().nullable().optional().describe(d);

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

export const TOOLS: ToolDef[] = [
  // ---------- board ----------
  {
    name: "board_list",
    title: "ボード一覧",
    description: "保存されているボードの一覧(id, title, updatedAt)。",
    scope: "store",
    schema: {},
    run: (store) => store.list(),
  },
  {
    name: "board_create",
    title: "ボード作成",
    description: "新しいボードを作る。title はトップイシュー(答えを出したい問い)。id は英数字・-・_。",
    scope: "store",
    schema: { id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), title: z.string() },
    run: async (store, { id, title }) => {
      if (await store.exists(id)) throw new C.CommandError(`board already exists: ${id}`);
      const b = C.createBoard(id, title);
      await store.save(b);
      return C.summary(b);
    },
  },
  {
    name: "board_get",
    title: "ボード取得",
    description:
      "ボードの内容を返す。view=summary(既定): 件数サマリ(再判定待ち・未反映メモ・open警告・TODO化されていない結論など)。view=full: 全データ。作業前にまず summary を見て状態を把握すること。",
    scope: "board-read",
    schema: { view: z.enum(["summary", "full"]).optional() },
    run: (b, { view }) => (view === "full" ? b : C.summary(b)),
  },
  {
    name: "board_set_title",
    title: "トップイシュー変更",
    description: "ボードのトップイシュー(問い)を変更する。",
    scope: "board",
    schema: { title: z.string() },
    run: (b, { title }) => (C.setTitle(b, title), C.summary(b)),
  },

  // ---------- frame / section ----------
  {
    name: "frame_create",
    title: "大項目(フレーム)作成",
    description: "大項目を作る。scopeText を渡すと草案(draft)として保存される(frame_approve_scope で承認するまで判定基準にならない)。名前だけで作ってよい。",
    scope: "board",
    schema: { name: z.string(), scopeText: z.string().optional() },
    run: (b, { name, scopeText }) => C.createFrame(b, name, scopeText),
  },
  {
    name: "frame_update",
    title: "大項目の更新",
    description: "名前またはスコープ定義文を更新。scopeText を変えると承認は取り消されて草案に戻り、配下カードは再判定待ちになる。",
    scope: "board",
    schema: { frameId: z.string(), name: z.string().optional(), scopeText: z.string().optional() },
    run: (b, { frameId, name, scopeText }) => C.updateFrame(b, frameId, { name, scopeText }),
  },
  {
    name: "frame_approve_scope",
    title: "スコープ定義を承認",
    description: "スコープ定義を承認する。承認済みフレームだけが越境(crossing)/モレ(gap)判定の基準になる。ユーザーの承認を得てから呼ぶこと。",
    scope: "board",
    schema: { frameId: z.string() },
    run: (b, { frameId }) => C.approveScope(b, frameId),
  },
  {
    name: "frame_delete",
    title: "大項目の削除",
    description: "大項目を削除。配下カードは未分類へ移り、セクションは消える。破壊的操作なのでユーザー確認の上で。",
    scope: "board",
    schema: { frameId: z.string() },
    run: (b, { frameId }) => C.deleteFrame(b, frameId),
  },
  {
    name: "section_create",
    title: "中項目(セクション)作成",
    description: "フレーム内に中項目を作る。2層で足りるなら作らなくてよい(カードはフレーム直下に置ける)。",
    scope: "board",
    schema: { frameId: z.string(), name: z.string() },
    run: (b, { frameId, name }) => C.createSection(b, frameId, name),
  },
  {
    name: "section_rename",
    title: "中項目の名前変更",
    description: "中項目の名前を変更。",
    scope: "board",
    schema: { frameId: z.string(), sectionId: z.string(), name: z.string() },
    run: (b, { frameId, sectionId, name }) => C.renameSection(b, frameId, sectionId, name),
  },
  {
    name: "section_delete",
    title: "中項目の削除",
    description: "中項目を削除。配下カードはフレーム直下へ移る。",
    scope: "board",
    schema: { frameId: z.string(), sectionId: z.string() },
    run: (b, { frameId, sectionId }) => C.deleteSection(b, frameId, sectionId),
  },

  // ---------- card ----------
  {
    name: "card_create",
    title: "カード作成",
    description:
      "検討内容(論点)のカードを作る。frameId 省略で未分類。新規カードは再判定待ち(judgedAt=null)になる。メモから起こす場合は note_to_card を使うこと(出所リンクが付く)。",
    scope: "board",
    schema: {
      text: z.string(),
      frameId: nullableId("配置先フレーム。null/省略で未分類"),
      sectionId: nullableId("配置先セクション(frameId 必須)"),
      status: status.optional(),
    },
    run: (b, { text, frameId, sectionId, status: st }) => C.createCard(b, text, { frameId, sectionId, status: st }),
  },
  {
    name: "card_update",
    title: "カード更新",
    description: "本文/ステータスを更新。本文が変わると再判定待ちになる(ステータス変更だけならならない)。ID リンク(メモ/TODO/警告)は維持される。",
    scope: "board",
    schema: { cardId: z.string(), text: z.string().optional(), status: status.optional() },
    run: (b, { cardId, text, status: st }) => C.updateCard(b, cardId, { text, status: st }),
  },
  {
    name: "card_move",
    title: "カード移動",
    description: "カードを別のフレーム/セクション(または未分類)へ移す。移動後は再判定待ちになる。crossing フラグに従う移動は flag_resolve(action=move) を使うこと。",
    scope: "board",
    schema: { cardId: z.string(), frameId: nullableId("移動先フレーム。null で未分類"), sectionId: nullableId("移動先セクション") },
    run: (b, { cardId, frameId, sectionId }) => C.moveCard(b, cardId, frameId ?? null, sectionId ?? null),
  },
  {
    name: "card_delete",
    title: "カード削除",
    description: "カードを削除。連鎖: 刺さっている警告は閉じる / 出所メモは未反映に戻る / TODO グループは残る(孤児として表示)。破壊的操作なのでユーザー確認の上で。",
    scope: "board",
    schema: { cardId: z.string() },
    run: (b, { cardId }) => C.deleteCard(b, cardId),
  },

  // ---------- note ----------
  {
    name: "note_add",
    title: "メモ追加",
    description:
      "会話で出た要件・気になること・疑問をそのままメモに入れる(1要素=1メモ)。整理はあとでカード化するので粒度は気にしなくてよい。ユーザーとの深掘り中に出た論点はこまめにここへ。",
    scope: "board",
    schema: { texts: z.array(z.string()).min(1) },
    run: (b, { texts }) => C.addNotes(b, texts),
  },
  {
    name: "note_update",
    title: "メモ更新",
    description: "メモ本文を更新。紐づくカードは変えない(メモは出所の記録)。",
    scope: "board",
    schema: { noteId: z.string(), text: z.string() },
    run: (b, { noteId, text }) => C.updateNote(b, noteId, text),
  },
  {
    name: "note_delete",
    title: "メモ削除",
    description: "メモを削除。カード化済みならカードは残る(出所なしになるだけ)。",
    scope: "board",
    schema: { noteId: z.string() },
    run: (b, { noteId }) => C.deleteNote(b, noteId),
  },
  {
    name: "note_to_card",
    title: "メモをカード化",
    description:
      "未反映メモからカードを作る(出所リンク付き)。配置先は承認済みスコープと照合して決める。該当なしなら frameId 省略で未分類へ。text で本文を整えてもよい。",
    scope: "board",
    schema: {
      noteId: z.string(),
      frameId: nullableId("配置先フレーム。省略で未分類"),
      sectionId: nullableId("配置先セクション"),
      text: z.string().optional().describe("カード本文(省略時はメモ本文)"),
      status: status.optional(),
    },
    run: (b, { noteId, frameId, sectionId, text, status: st }) => C.noteToCard(b, noteId, { frameId, sectionId, text, status: st }),
  },

  // ---------- MECE ----------
  {
    name: "mece_material",
    title: "MECE判定の材料を取得",
    description:
      "ダブり(越境/重複)・モレ判定に必要な材料(トップイシュー、各フレームのスコープ定義と承認状態、全カード、再判定待ちカード、既存の open 警告、却下記録)を返す。判定はあなた(呼び出し側モデル)が行い、結果を mece_report で書き戻す。サーバーは LLM を呼ばない。",
    scope: "board-read",
    schema: {},
    run: (b) => C.meceMaterial(b),
  },
  {
    name: "mece_report",
    title: "MECE判定結果の書き戻し",
    description:
      "判定結果を保存する。flags: crossing(越境)/duplicate(重複)/dependency(依存)。gaps: モレ候補。judgedCardIds: 判定を済ませたカード(再判定待ちが解消される)。却下済み・既に open のものは自動でスキップされる。",
    scope: "board",
    schema: { flags: z.array(flagInput).optional(), gaps: z.array(gapInput).optional(), judgedCardIds: z.array(z.string()).optional() },
    run: (b, { flags, gaps, judgedCardIds }) => C.reportJudgment(b, { flags, gaps, judgedCardIds }),
  },
  {
    name: "flag_resolve",
    title: "警告の解決",
    description:
      "open な警告を処理する。move: crossing の提案先へ移動 / merge: duplicate の片方を削除(既定は cardId 側を削除、keep=card で target 側を削除。出所メモは残る側へ) / dismiss: 別物として却下(同じ組み合わせは再警告しない) / resolve: 手動対応済み。ユーザーの判断を確認してから呼ぶこと。",
    scope: "board",
    schema: { flagId: z.string(), action: z.enum(["move", "merge", "dismiss", "resolve"]), keep: z.enum(["card", "target"]).optional() },
    run: (b, { flagId, action, keep }) => C.resolveFlag(b, flagId, action === "merge" ? { action, keep } : { action }),
  },
  {
    name: "gap_resolve",
    title: "モレ候補の処理",
    description:
      "adopt: 採用(level=board は新フレーム、level=frame はそのフレーム内カードとして作成。as/text/frameId/sectionId で上書き可) / dismiss: 不要(同じ候補は再提示しない)。",
    scope: "board",
    schema: {
      gapId: z.string(),
      action: z.enum(["adopt", "dismiss"]),
      as: z.enum(["card", "frame"]).optional(),
      text: z.string().optional(),
      frameId: z.string().nullable().optional(),
      sectionId: z.string().nullable().optional(),
    },
    run: (b, { gapId, action, as, text, frameId, sectionId }) =>
      C.resolveGap(b, gapId, action === "adopt" ? { action, as, text, frameId, sectionId } : { action }),
  },

  // ---------- todo ----------
  {
    name: "todo_group_create",
    title: "タスクグループ作成",
    description: "結論が出た要件カードに対して実装タスクのグループを作る(1カード1グループ)。title 省略でカード本文。",
    scope: "board",
    schema: { cardId: z.string(), title: z.string().optional() },
    run: (b, { cardId, title }) => C.createTodoGroup(b, cardId, title),
  },
  {
    name: "todo_group_update",
    title: "タスクグループ更新",
    description: "タイトル変更、または cardId で要件カードの付け替え(孤児グループの救済)。",
    scope: "board",
    schema: { groupId: z.string(), title: z.string().optional(), cardId: z.string().optional() },
    run: (b, { groupId, title, cardId }) => C.updateTodoGroup(b, groupId, { title, cardId }),
  },
  {
    name: "todo_group_delete",
    title: "タスクグループ削除",
    description: "グループをタスクごと削除。要件カードには影響しない。",
    scope: "board",
    schema: { groupId: z.string() },
    run: (b, { groupId }) => (C.deleteTodoGroup(b, groupId), { deleted: groupId }),
  },
  {
    name: "todo_task_add",
    title: "タスク追加",
    description: "グループにタスクを追加。parentTaskId を渡すとそのタスクの細分化(サブタスク、1段のみ)。",
    scope: "board",
    schema: { groupId: z.string(), text: z.string(), parentTaskId: z.string().nullable().optional() },
    run: (b, { groupId, text, parentTaskId }) => C.addTask(b, groupId, text, parentTaskId),
  },
  {
    name: "todo_task_update",
    title: "タスク更新",
    description: "本文/完了状態を更新。親を完了にすると子も完了、子を未完に戻すと親も未完になる。",
    scope: "board",
    schema: { groupId: z.string(), taskId: z.string(), text: z.string().optional(), done: z.boolean().optional() },
    run: (b, { groupId, taskId, text, done }) => C.updateTask(b, groupId, taskId, { text, done }),
  },
  {
    name: "todo_task_delete",
    title: "タスク削除",
    description: "タスク削除(親ならサブタスクごと)。",
    scope: "board",
    schema: { groupId: z.string(), taskId: z.string() },
    run: (b, { groupId, taskId }) => (C.deleteTask(b, groupId, taskId), { deleted: taskId }),
  },
];

export const toolByName = new Map(TOOLS.map((t) => [t.name, t]));
