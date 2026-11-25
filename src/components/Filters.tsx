"use client";

import { useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function useSetParam() {
  const router = useRouter();
  const search = useSearchParams();
  return (key: string, value: string) => {
    const sp = new URLSearchParams(search.toString());
    if (value === "") sp.delete(key);
    else sp.set(key, value);
    sp.delete("page");
    router.push(`?${sp.toString()}`);
  };
}

function cleanParams(sp: URLSearchParams, keep: string[]): URLSearchParams {
  const next = new URLSearchParams();
  for (const [k, v] of sp.entries()) if (keep.includes(k) && v) next.set(k, v);
  return next;
}

// ParkPrice-style "Filter" button with an active-filters badge, opening a modal
// whose fields are passed as children inside its GET form.
export function FilterButton({
  active,
  hidden = {},
  resetParams = [],
  children,
}: {
  active: number;
  hidden?: Record<string, string | undefined>;
  resetParams?: string[];
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const sp = useSearchParams();
  const resetQs = cleanParams(new URLSearchParams(sp.toString()), resetParams).toString();
  return (
    <>
      <button type="button" className="pp-btn" onClick={() => setOpen(true)} aria-label="Filter">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
          <path d="M1.5 1h13l-5 6.5V14l-3 1.5V7.5z" />
        </svg>
        Filter
        {active > 0 ? <span className="pp-badge">{active}</span> : null}
      </button>
      {open ? (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="modal-card filter-modal">
            <div className="modal-head">
              <span>Filter</span>
              <button type="button" className="modal-close" onClick={() => setOpen(false)} aria-label="Close">
                ×
              </button>
            </div>
            <form method="get" action="" onSubmit={() => setTimeout(() => setOpen(false), 0)}>
              {Object.entries(hidden).map(([k, v]) =>
                v !== undefined && v !== "" ? <input key={k} type="hidden" name={k} value={v} /> : null,
              )}
              {children}
              <div className="modal-actions">
                <button className="button" type="submit">
                  Apply
                </button>
                <a className="button ghost" href={`?${resetQs}`} onClick={() => setOpen(false)}>
                  Reset
                </a>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}

// ParkPrice-style "Order" button -> modal with column + ascending/descending.
export function SortButton({
  columns,
  hidden = {},
}: {
  columns: { value: string; label: string }[];
  hidden?: Record<string, string | undefined>;
}) {
  const [open, setOpen] = useState(false);
  const sp = useSearchParams();
  const col = sp.get("sortcol") || columns[0].value;
  const dir = sp.get("sortdir") || "asc";
  return (
    <>
      <button type="button" className="pp-btn" onClick={() => setOpen(true)} aria-label="Order">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
          <path d="M2 3h9l-3 3H2zM2 7h6L5 10H2zM2 11h3l-2 3H2z" transform="rotate(90 8 8)" />
        </svg>
        Order
      </button>
      {open ? (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="modal-card" style={{ maxWidth: 380 }}>
            <div className="modal-head">
              <span>Listing order</span>
              <button type="button" className="modal-close" onClick={() => setOpen(false)} aria-label="Close">
                ×
              </button>
            </div>
            <form method="get" action="" onSubmit={() => setTimeout(() => setOpen(false), 0)}>
              {Object.entries(hidden).map(([k, v]) =>
                v !== undefined && v !== "" ? <input key={k} type="hidden" name={k} value={v} /> : null,
              )}
              <label className="field">
                <span>Column</span>
                <select name="sortcol" defaultValue={col}>
                  {columns.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Direction</span>
                <select name="sortdir" defaultValue={dir}>
                  <option value="asc">Ascending</option>
                  <option value="desc">Descending</option>
                </select>
              </label>
              <div className="modal-actions">
                <button className="button" type="submit">
                  Apply
                </button>
                <a className="button ghost" href={`?${cleanParams(new URLSearchParams(sp.toString()), ["view", "ps"]).toString()}`} onClick={() => setOpen(false)}>
                  Reset
                </a>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}

// Instant page-size / view switcher (updates one param, resets paging).
export function ParamSelect({ name, value, options }: { name: string; value: string; options: { value: string; label: string }[] }) {
  const setParam = useSetParam();
  return (
    <select
      className="pp-autosubmit"
      value={value}
      aria-label={name}
      onChange={(e) => setParam(name, e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ParkPrice-style table/cards view toggle.
export function ViewToggle({ view }: { view: "table" | "cards" }) {
  const setParam = useSetParam();
  return (
    <button
      type="button"
      className="pp-btn"
      aria-label="Switch view"
      title="Switch between table and card view"
      onClick={() => setParam("view", view === "table" ? "cards" : "table")}
    >
      {view === "table" ? (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
          <path d="M1 2h6v6H1zM9 2h6v6H9zM1 10h6v4H1zM9 10h6v4H9z" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
          <path d="M1 2h14v2H1zM1 7h14v2H1zM1 12h14v2H1z" />
        </svg>
      )}
    </button>
  );
}

// Brand → Sub-line filter group: the sub-line select adapts to the chosen
// brand family and is greyed out (disabled) when the brand has no sub-lines
// (or when no brand is selected yet).
export function BrandSubLine({
  families,
  subLines,
  brand,
  subline,
}: {
  families: string[];
  subLines: Record<string, string[]>;
  brand: string;
  subline: string;
}) {
  const [family, setFamily] = useState(brand);
  const [sub, setSub] = useState(subline);
  const options = family ? (subLines[family] ?? null) : null;
  const activeSub = options?.includes(sub) ? sub : "";
  return (
    <div className="field-grid">
      <label className="field">
        <span>Brand</span>
        <select
          name="brand"
          value={family}
          onChange={(e) => {
            setFamily(e.target.value);
            setSub("");
          }}
        >
          <option value="">Any brand</option>
          {families.map((f) => (
            <option key={f} value={f}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </option>
          ))}
        </select>
      </label>
      <label className="field" style={{ opacity: options ? 1 : 0.45 }}>
        <span>Sub-line</span>
        <select
          name="subline"
          value={activeSub}
          disabled={!options}
          onChange={(e) => setSub(e.currentTarget.value)}
          aria-disabled={!options}
        >
          {options === null ? (
            <option value="">{family ? "No sub-lines" : "Choose a brand first"}</option>
          ) : (
            options.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))
          )}
        </select>
      </label>
    </div>
  );
}
