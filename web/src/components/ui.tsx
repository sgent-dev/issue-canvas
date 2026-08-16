import { useEffect, useRef, useState, type ReactNode } from "react";

/** インライン編集: Enter 確定 / Esc 取消 / blur 確定 */
export function InlineText({
  value,
  onCommit,
  className,
  as = "span",
  editing,
  onEditingChange,
  multiline,
}: {
  value: string;
  onCommit: (v: string) => void;
  className?: string;
  as?: "span" | "p" | "h1";
  editing?: boolean;
  onEditingChange?: (e: boolean) => void;
  multiline?: boolean;
}) {
  const [local, setLocal] = useState(editing ?? false);
  const isEditing = editing ?? local;
  const setEditing = (e: boolean) => {
    setLocal(e);
    onEditingChange?.(e);
  };
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement>(null);
  useEffect(() => {
    if (isEditing) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [isEditing]);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value, isEditing]);
  const commit = () => {
    const v = draft.trim();
    setEditing(false);
    if (v && v !== value) onCommit(v);
  };
  if (!isEditing) {
    const Tag = as;
    return (
      <Tag className={className} onDoubleClick={() => setEditing(true)} title="ダブルクリックで編集">
        {value}
      </Tag>
    );
  }
  const common = {
    className: `inline-edit ${className ?? ""}`,
    value: draft,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !(multiline && e.shiftKey)) {
        e.preventDefault();
        commit();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDraft(value);
        setEditing(false);
      }
    },
  };
  return multiline ? (
    <textarea ref={ref as React.RefObject<HTMLTextAreaElement>} rows={3} {...common} />
  ) : (
    <input ref={ref as React.RefObject<HTMLInputElement>} {...common} />
  );
}

/** ホバーで出る ✎ × ボタン */
export function Ctl({ onEdit, onDelete, extra }: { onEdit?: () => void; onDelete?: () => void; extra?: ReactNode }) {
  return (
    <span className="ctl">
      {extra}
      {onEdit && (
        <button title="編集" onClick={(e) => (e.stopPropagation(), onEdit())}>
          ✎
        </button>
      )}
      {onDelete && <ConfirmButton onConfirm={onDelete} />}
    </span>
  );
}

/** 2 段階の削除ボタン(ダイアログを出さない) */
export function ConfirmButton({ onConfirm, label = "×", confirmLabel = "削除する" }: { onConfirm: () => void; label?: string; confirmLabel?: string }) {
  const [arm, setArm] = useState(false);
  useEffect(() => {
    if (!arm) return;
    const t = setTimeout(() => setArm(false), 3000);
    return () => clearTimeout(t);
  }, [arm]);
  return arm ? (
    <button
      className="del armed"
      title="クリックで確定"
      onClick={(e) => {
        e.stopPropagation();
        setArm(false);
        onConfirm();
      }}
    >
      {confirmLabel}
    </button>
  ) : (
    <button className="del" title="削除" onClick={(e) => (e.stopPropagation(), setArm(true))}>
      {label}
    </button>
  );
}

/** クリックで開くポップオーバー(アンカーの直下) */
export function Popover({ trigger, children, kind, title }: { trigger: ReactNode; children: (close: () => void) => ReactNode; kind?: "danger" | "warn" | "info"; title: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <span className="pop-anchor" ref={ref} onPointerDown={(e) => e.stopPropagation()}>
      <span onClick={(e) => (e.stopPropagation(), setOpen((o) => !o))}>{trigger}</span>
      {open && (
        <div className="pop" role="dialog">
          <div className={`pop-kind k-${kind ?? "info"}`}>{title}</div>
          {children(() => setOpen(false))}
        </div>
      )}
    </span>
  );
}

export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const toast = (m: string) => {
    setMsg(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 3800);
  };
  return { msg, toast };
}

export function LocationSelect({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <select className={`loc-select ${className ?? ""}`} value={value} onChange={(e) => onChange(e.target.value)} onPointerDown={(e) => e.stopPropagation()}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** 狭い画面(スマホ幅)かどうか。styles.css の @media (max-width: 640px) と同じ閾値。 */
export const NARROW_QUERY = "(max-width: 640px)";
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => (typeof window !== "undefined" ? window.matchMedia(NARROW_QUERY).matches : false));
  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY);
    const on = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}
