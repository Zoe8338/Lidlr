type Point = { t: Date; price: number };

export function PriceChart({ points, height = 180 }: { points: Point[]; height?: number }) {
  if (points.length < 2) {
    return <div className="empty">Not enough price history yet — snapshots collect as the crawler re-runs.</div>;
  }
  const w = 720;
  const h = height;
  const pad = 28;
  const prices = points.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const t0 = points[0].t.getTime();
  const t1 = points[points.length - 1].t.getTime();
  const spanT = t1 - t0 || 1;
  const x = (t: number) => pad + ((t - t0) / spanT) * (w - 2 * pad);
  const y = (p: number) => h - pad - ((p - min) / span) * (h - 2 * pad);
  const line = points.map((p) => `${x(p.t.getTime()).toFixed(1)},${y(p.price).toFixed(1)}`).join(" ");
  const area = `${pad},${h - pad} ${line} ${x(t1).toFixed(1)},${h - pad}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ background: "var(--surface)", borderRadius: 10, border: "1px solid var(--border)" }}>
      <polygon points={area} fill="rgba(77,163,255,0.12)" />
      <polyline points={line} fill="none" stroke="#4da3ff" strokeWidth="2" />
      <text x={pad} y={16} fill="var(--muted)" fontSize="11">
        max {max.toFixed(2)}
      </text>
      <text x={pad} y={h - 8} fill="var(--muted)" fontSize="11">
        min {min.toFixed(2)} · {points.length} snapshots · {new Date(t0).toLocaleDateString()} → {new Date(t1).toLocaleDateString()}
      </text>
    </svg>
  );
}
