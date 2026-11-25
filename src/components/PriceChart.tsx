"use client";

import { useState } from "react";
import { convert, fmtEur, fmtLocal, type FxRates } from "@/lib/fx";

export type ChartPoint = { t: Date; price: number };
export type ChartSeries = { cc: string; currency: string; color: string; points: ChartPoint[] };

function ChartSvg({
  series,
  fx,
  mode,
  height = 220,
}: {
  series: ChartSeries[];
  fx: FxRates | null;
  mode: "eur" | "local";
  height?: number;
}) {
  const w = 720;
  const h = height;
  const padL = 52;
  const pad = 28;
  const toVal = (price: number, currency: string): number | null => {
    if (mode === "local") return price;
    if (!currency) return null;
    return fx ? convert(price, currency, "EUR", fx) : currency === "EUR" ? price : null;
  };
  const batches = series.map((s) => ({
    s,
    pts: s.points
      .map((p) => ({ t: p.t, v: toVal(p.price, s.currency) }))
      .filter((p): p is { t: Date; v: number } => p.v != null),
  }));
  const usable = batches.filter((b) => b.pts.length >= 2);
  if (!usable.length) return null;
  const all = usable.flatMap((b) => b.pts.map((p) => p.v));
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const t0 = Math.min(...usable.map((b) => b.pts[0].t.getTime()));
  const t1 = Math.max(...usable.map((b) => b.pts[b.pts.length - 1].t.getTime()));
  const spanT = t1 - t0 || 1;
  const x = (t: number) => padL + ((t - t0) / spanT) * (w - padL - pad);
  const y = (p: number) => h - pad - ((p - min) / span) * (h - 2 * pad);
  const fmtY = (v: number) =>
    mode === "eur"
      ? fmtEur(v)
      : (() => {
          const c = series.find((s) => s.currency)?.currency;
          return c ? fmtLocal(v, c) || v.toFixed(2) : v.toFixed(2);
        })();

  const gridYs = [0, 0.25, 0.5, 0.75, 1].map((f) => min + f * span);

  return (
    <div style={{ marginBottom: 12 }}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width="100%"
        style={{ background: "var(--surface)", borderRadius: 10, border: "1px solid var(--border)" }}
      >
        {gridYs.map((v, i) => (
          <g key={i}>
            <line x1={padL} x2={w - pad} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth="1" />
            <text x={padL - 6} y={y(v) + 3.5} fill="var(--muted)" fontSize="10" textAnchor="end">
              {fmtY(v)}
            </text>
          </g>
        ))}
        {usable.map(({ s, pts }) => {
          const line = pts.map((p) => `${x(p.t.getTime()).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
          return (
            <polyline key={s.cc} points={line} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" />
          );
        })}
        <text x={padL} y={12} fill="var(--muted)" fontSize="11">
          {new Date(t0).toLocaleDateString()} → {new Date(t1).toLocaleDateString()}
        </text>
      </svg>
      <div className="chart-legend">
        {usable.map(({ s }) => (
          <span key={s.cc} className="chart-key">
            <i style={{ background: s.color }} /> {s.cc}
            {s.currency !== "EUR" && mode === "eur" ? " (conv.)" : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

export function PriceChart({
  series,
  fx,
  height = 220,
}: {
  series: ChartSeries[];
  fx: FxRates | null;
  height?: number;
}) {
  const [mode, setMode] = useState<"eur" | "local">("eur");
  const usable = series.filter((s) => s.points.length >= 2);
  if (!usable.length) {
    return <div className="empty">Not enough price history yet — snapshots collect as the crawler re-runs.</div>;
  }
  const currencies = [...new Set(usable.map((s) => s.currency))];
  const groups =
    mode === "eur" || currencies.length <= 1
      ? [usable]
      : currencies.map((c) => usable.filter((s) => s.currency === c));

  return (
    <div>
      <div className="chart-toggle">
        <button type="button" className={mode === "eur" ? "active" : ""} onClick={() => setMode("eur")}>
          EUR
        </button>
        <button type="button" className={mode === "local" ? "active" : ""} onClick={() => setMode("local")}>
          {currencies.length <= 1 ? currencies[0] || "Local" : "Local (per country)"}
        </button>
      </div>
      {groups.map((g, i) => (
        <ChartSvg key={i} series={g} fx={fx} mode={mode} height={height} />
      ))}
      {mode === "eur" ? (
        <p style={{ color: "var(--muted)", fontSize: 12, margin: "4px 0 0" }}>
          Lines are converted to EUR at the current ECB reference rate (historical rates are not captured per
          snapshot). Switch to “Local” to see each country in its own currency.
        </p>
      ) : null}
    </div>
  );
}
