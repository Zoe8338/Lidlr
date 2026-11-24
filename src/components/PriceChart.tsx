"use client";

export type ChartPoint = { t: Date; price: number };
export type ChartSeries = { cc: string; color: string; points: ChartPoint[] };

export function PriceChart({ series, height = 220 }: { series: ChartSeries[]; height?: number }) {
  const usable = series.filter((s) => s.points.length >= 2);
  if (!usable.length) {
    return <div className="empty">Not enough price history yet — snapshots collect as the crawler re-runs.</div>;
  }
  const w = 720;
  const h = height;
  const padL = 44;
  const pad = 28;
  const all = usable.flatMap((s) => s.points);
  const min = Math.min(...all.map((p) => p.price));
  const max = Math.max(...all.map((p) => p.price));
  const span = max - min || 1;
  const t0 = Math.min(...usable.map((s) => s.points[0].t.getTime()));
  const t1 = Math.max(...usable.map((s) => s.points[s.points.length - 1].t.getTime()));
  const spanT = t1 - t0 || 1;
  const x = (t: number) => padL + ((t - t0) / spanT) * (w - padL - pad);
  const y = (p: number) => h - pad - ((p - min) / span) * (h - 2 * pad);

  const gridYs = [0, 0.25, 0.5, 0.75, 1].map((f) => min + f * span);

  return (
    <div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width="100%"
        style={{ background: "var(--surface)", borderRadius: 10, border: "1px solid var(--border)" }}
      >
        {gridYs.map((v, i) => (
          <g key={i}>
            <line x1={padL} x2={w - pad} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth="1" />
            <text x={padL - 6} y={y(v) + 3.5} fill="var(--muted)" fontSize="10" textAnchor="end">
              {v.toFixed(2)}
            </text>
          </g>
        ))}
        {usable.map((s) => {
          const line = s.points.map((p) => `${x(p.t.getTime()).toFixed(1)},${y(p.price).toFixed(1)}`).join(" ");
          return (
            <polyline key={s.cc} points={line} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" />
          );
        })}
        <text x={padL} y={12} fill="var(--muted)" fontSize="11">
          {new Date(t0).toLocaleDateString()} → {new Date(t1).toLocaleDateString()}
        </text>
      </svg>
      <div className="chart-legend">
        {usable.map((s) => (
          <span key={s.cc} className="chart-key">
            <i style={{ background: s.color }} /> {s.cc}
          </span>
        ))}
      </div>
    </div>
  );
}
