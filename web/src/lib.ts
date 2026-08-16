import type { Board, Card, CardStatus, Flag, Frame, Gap } from "../../src/core/types.ts";

export const STATUSES: CardStatus[] = ["論点候補", "イシュー化", "仮説あり", "結論"];
export const statusClass: Record<CardStatus, string> = {
  論点候補: "s-cand",
  イシュー化: "s-issue",
  仮説あり: "s-hypo",
  結論: "s-done",
};

export const isStale = (c: Card): boolean => c.judgedAt === null || c.judgedAt < c.updatedAt;

export function frameOf(b: Board, id: string | null): Frame | undefined {
  return id ? b.frames.find((f) => f.id === id) : undefined;
}
export function cardOf(b: Board, id: string | null | undefined): Card | undefined {
  return id ? b.cards.find((c) => c.id === id) : undefined;
}
export function pathOf(b: Board, c: Card): string {
  const f = frameOf(b, c.frameId);
  if (!f) return "未分類";
  const s = c.sectionId ? f.sections.find((x) => x.id === c.sectionId) : undefined;
  return s ? `${f.name} > ${s.name}` : f.name;
}
export function locationLabel(b: Board, frameId: string | null, sectionId: string | null): string {
  const f = frameOf(b, frameId);
  if (!f) return "未分類";
  const s = sectionId ? f.sections.find((x) => x.id === sectionId) : undefined;
  return s ? `${f.name} > ${s.name}` : f.name;
}

export const openFlags = (b: Board): Flag[] => b.flags.filter((f) => f.status === "open");
export const openGaps = (b: Board): Gap[] => b.gaps.filter((g) => g.status === "open");
export const flagsForCard = (b: Board, cardId: string): Flag[] =>
  openFlags(b).filter((f) => f.cardId === cardId || (f.type !== "crossing" && f.targetCardId === cardId));

export function progress(b: Board, frameId: string): { done: number; total: number } {
  const cs = b.cards.filter((c) => c.frameId === frameId);
  return { done: cs.filter((c) => c.status === "結論").length, total: cs.length };
}

/** 配置先の選択肢(未分類 + フレーム + フレーム>セクション) */
export function locationOptions(b: Board): { value: string; label: string; frameId: string | null; sectionId: string | null }[] {
  const out = [{ value: "", label: "未分類", frameId: null as string | null, sectionId: null as string | null }];
  for (const f of b.frames) {
    out.push({ value: f.id, label: f.name, frameId: f.id, sectionId: null });
    for (const s of f.sections) out.push({ value: `${f.id}/${s.id}`, label: `${f.name} > ${s.name}`, frameId: f.id, sectionId: s.id });
  }
  return out;
}
export const locationValue = (frameId: string | null, sectionId: string | null): string =>
  frameId ? (sectionId ? `${frameId}/${sectionId}` : frameId) : "";
