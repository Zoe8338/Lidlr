"use client";

import { useEffect, useState } from "react";

export type ToastItem = { id: string; ok: boolean; title: string; detail?: string | null };

const TOAST_MS = 10_000;

// Toast-style notifications rendered fixed at the top of the site; each one
// disappears by itself after 10 seconds (or immediately via the × button).
export function ToastStack({ items }: { items: ToastItem[] }) {
  const [visible, setVisible] = useState<ToastItem[]>(items);

  useEffect(() => {
    setVisible(items);
    const timers = items.map((t) =>
      setTimeout(() => setVisible((v) => v.filter((x) => x.id !== t.id)), TOAST_MS),
    );
    return () => timers.forEach(clearTimeout);
    // items is a fresh array on every server render; resetting on it is intended
  }, [items]);

  if (!visible.length) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {visible.map((t) => (
        <div key={t.id} className={t.ok ? "toast" : "toast err"}>
          <div className="toast-body">
            <strong>{t.title}</strong>
            {t.detail ? <span>{t.detail}</span> : null}
          </div>
          <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => setVisible((v) => v.filter((x) => x.id !== t.id))}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
