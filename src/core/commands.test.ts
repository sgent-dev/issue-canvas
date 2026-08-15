import { test } from "node:test";
import assert from "node:assert/strict";
import * as C from "./commands.js";
import { isStale } from "./types.js";

function fixture() {
  const b = C.createBoard("t", "問い");
  const A = C.createFrame(b, "案件獲得", "新規顧客との接点づくりから受注まで");
  C.approveScope(b, A.id);
  const secRef = C.createSection(b, A.id, "紹介経路");
  const B = C.createFrame(b, "提供サービスの型化", "メニュー・価格・納品物の標準化");
  C.approveScope(b, B.id);
  const a1 = C.createCard(b, "知人経由の紹介ルートの棚卸し", { frameId: A.id, sectionId: secRef.id, status: "結論" });
  const b3 = C.createCard(b, "セミナー登壇で見込み客を集める", { frameId: B.id });
  return { b, A, B, secRef, a1, b3 };
}

test("new card is stale; judged card is fresh; text edit makes it stale again, status edit does not", () => {
  const { b, a1 } = fixture();
  assert.equal(isStale(a1), true);
  C.reportJudgment(b, { judgedCardIds: [a1.id] });
  assert.equal(isStale(C.getCard(b, a1.id)), false);
  C.updateCard(b, a1.id, { status: "仮説あり" });
  assert.equal(isStale(C.getCard(b, a1.id)), false);
  C.updateCard(b, a1.id, { text: "知人経由の紹介ルートの棚卸しと再接触" });
  assert.equal(isStale(C.getCard(b, a1.id)), true);
});

test("note -> card keeps ID link; card text edit keeps link; card delete unlinks note", () => {
  const { b, A } = fixture();
  const [n] = C.addNotes(b, ["紹介料の設計はどうする?"]);
  const c = C.noteToCard(b, n.id, { frameId: A.id, text: "紹介料の設計" });
  assert.equal(C.getNote(b, n.id).cardId, c.id);
  assert.deepEqual(c.noteIds, [n.id]);
  C.updateCard(b, c.id, { text: "紹介料・お礼の設計" });
  assert.equal(C.getNote(b, n.id).cardId, c.id);
  const r = C.deleteCard(b, c.id);
  assert.deepEqual(r.unlinkedNoteIds, [n.id]);
  assert.equal(C.getNote(b, n.id).cardId, null);
  assert.equal(C.summary(b).notes.pending, 1);
});

test("crossing flag -> move resolves and card lands in target section", () => {
  const { b, A, secRef, b3 } = fixture();
  const r = C.reportJudgment(b, {
    flags: [{ type: "crossing", cardId: b3.id, targetFrameId: A.id, targetSectionId: secRef.id, reason: "接点づくりに該当" }],
    judgedCardIds: [b3.id],
  });
  assert.equal(r.addedFlags.length, 1);
  const res = C.resolveFlag(b, r.addedFlags[0].id, { action: "move" });
  assert.equal(res.movedCardId, b3.id);
  const moved = C.getCard(b, b3.id);
  assert.equal(moved.frameId, A.id);
  assert.equal(moved.sectionId, secRef.id);
  assert.equal(isStale(moved), false);
  assert.equal(C.summary(b).openFlags.crossing, 0);
});

test("dismissed flag is not re-reported", () => {
  const { b, A, b3 } = fixture();
  const r1 = C.reportJudgment(b, { flags: [{ type: "crossing", cardId: b3.id, targetFrameId: A.id, reason: "x" }] });
  C.resolveFlag(b, r1.addedFlags[0].id, { action: "dismiss" });
  const r2 = C.reportJudgment(b, { flags: [{ type: "crossing", cardId: b3.id, targetFrameId: A.id, reason: "x again" }] });
  assert.equal(r2.addedFlags.length, 0);
  assert.match(r2.skipped[0], /dismissed/);
});

test("duplicate merge keeps target, re-links notes, closes flag", () => {
  const { b, a1 } = fixture();
  const [n] = C.addNotes(b, ["人脈からの紹介の仕組み化"]);
  const u1 = C.noteToCard(b, n.id);
  const r = C.reportJudgment(b, { flags: [{ type: "duplicate", cardId: u1.id, targetCardId: a1.id, reason: "同一論点" }] });
  const res = C.resolveFlag(b, r.addedFlags[0].id, { action: "merge" });
  assert.equal(res.deletedCardId, u1.id);
  assert.equal(C.getNote(b, n.id).cardId, a1.id);
  assert.ok(C.getCard(b, a1.id).noteIds.includes(n.id));
});

test("gap adopt: board-level -> new frame (draft scope); frame-level -> card in frame", () => {
  const { b, A } = fixture();
  const r = C.reportJudgment(b, {
    gaps: [
      { level: "board", title: "稼働キャパシティ", reason: "時間制約がどこにもない" },
      { level: "frame", frameId: A.id, title: "紹介後のフォロー", reason: "スコープに対して未検討" },
    ],
  });
  const g1 = C.resolveGap(b, r.addedGaps[0].id, { action: "adopt" });
  assert.equal(g1.frame?.name, "稼働キャパシティ");
  assert.equal(g1.frame?.scope.status, "draft");
  const g2 = C.resolveGap(b, r.addedGaps[1].id, { action: "adopt" });
  assert.equal(g2.card?.frameId, A.id);
});

test("todo: group per concluded card, parent/child done cascade, orphan on card delete", () => {
  const { b, a1 } = fixture();
  assert.equal(C.summary(b).concludedWithoutTodo.length, 1);
  const g = C.createTodoGroup(b, a1.id);
  assert.equal(C.summary(b).concludedWithoutTodo.length, 0);
  const t = C.addTask(b, g.id, "リスト化");
  const s = C.addTask(b, g.id, "テンプレ作成", t.id);
  C.updateTask(b, g.id, t.id, { done: true });
  assert.equal(C.getGroup(b, g.id).tasks[0].subs[0].done, true);
  C.updateTask(b, g.id, s.id, { done: false });
  assert.equal(C.getGroup(b, g.id).tasks[0].done, false);
  C.deleteCard(b, a1.id);
  assert.equal(C.summary(b).todo.orphanGroups, 1);
  assert.equal(C.getGroup(b, g.id).tasks.length, 1);
});

test("scope text change revokes approval and marks frame cards stale", () => {
  const { b, A, a1 } = fixture();
  C.reportJudgment(b, { judgedCardIds: [a1.id] });
  C.updateFrame(b, A.id, { scopeText: "新規顧客との接点づくりから受注、初回打合せまで" });
  assert.equal(C.getFrame(b, A.id).scope.status, "draft");
  assert.equal(isStale(C.getCard(b, a1.id)), true);
});
