/**
 * Issue Canvas — データモデル (v1)
 *
 * 流れ: Note(メモ) → Card(カード, MECEに整理) → TodoGroup(実装タスク)
 * リンクはすべて ID で持つ。本文編集でリンクは壊れない。
 */

export type CardStatus = "論点候補" | "イシュー化" | "仮説あり" | "結論";
export const CARD_STATUSES: CardStatus[] = ["論点候補", "イシュー化", "仮説あり", "結論"];

export type ScopeStatus = "none" | "draft" | "approved";

export interface Section {
  id: string;
  name: string;
  createdAt: string;
}

export interface Frame {
  id: string;
  name: string;
  /** スコープ定義文。approved のものだけが越境/漏れ判定の基準になる */
  scope: { text: string; status: ScopeStatus };
  sections: Section[];
  createdAt: string;
  updatedAt: string;
}

export interface Card {
  id: string;
  text: string;
  status: CardStatus;
  /** null = 未分類 */
  frameId: string | null;
  sectionId: string | null;
  /** 出所メモ */
  noteIds: string[];
  createdAt: string;
  updatedAt: string;
  /** 最後にダブり判定を受けた時刻。null または updatedAt より古ければ「再判定待ち」 */
  judgedAt: string | null;
}

export interface Note {
  id: string;
  text: string;
  /** カード化されていれば card id */
  cardId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type FlagType = "crossing" | "duplicate" | "dependency";
export type FlagStatus = "open" | "resolved" | "dismissed";

/** ダブり判定の結果 (crossing/duplicate は MECE 違反、dependency は警告ではない関連リンク) */
export interface Flag {
  id: string;
  type: FlagType;
  cardId: string;
  /** duplicate/dependency: 相手カード。crossing: 本来属すべきフレーム */
  targetCardId: string | null;
  targetFrameId: string | null;
  targetSectionId: string | null;
  reason: string;
  status: FlagStatus;
  createdAt: string;
  resolvedAt: string | null;
}

export type GapStatus = "open" | "adopted" | "dismissed";

/** 漏れ判定の結果 (level=board: 大項目として欠けている / level=frame: フレーム内で未検討) */
export interface Gap {
  id: string;
  level: "board" | "frame";
  frameId: string | null;
  title: string;
  reason: string;
  status: GapStatus;
  createdAt: string;
  resolvedAt: string | null;
}

export interface SubTask {
  id: string;
  text: string;
  done: boolean;
}

export interface Task {
  id: string;
  text: string;
  done: boolean;
  subs: SubTask[];
}

export interface TodoGroup {
  id: string;
  /** 要件カード。削除されても group は残り、UI で「要件カード削除済み」表示 */
  cardId: string;
  title: string;
  tasks: Task[];
  createdAt: string;
  updatedAt: string;
}

/** 「別物として却下」の記録。同じ組み合わせを再警告しないため */
export interface Dismissal {
  type: FlagType | "gap";
  key: string; // e.g. "crossing:card:frame" / "duplicate:cardA:cardB" / "gap:title-hash"
  at: string;
}

export interface Board {
  version: 1;
  id: string;
  /** トップイシュー(問い) */
  title: string;
  frames: Frame[];
  cards: Card[];
  notes: Note[];
  flags: Flag[];
  gaps: Gap[];
  todoGroups: TodoGroup[];
  dismissals: Dismissal[];
  createdAt: string;
  updatedAt: string;
}

export function isStale(card: Card): boolean {
  return card.judgedAt === null || card.judgedAt < card.updatedAt;
}
