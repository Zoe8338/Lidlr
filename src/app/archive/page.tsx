import Link from "next/link";
import { prisma } from "@/lib/db";
import { COUNTRIES } from "@/lib/lidl/catalog";
import { fetchLeafletsAction } from "@/app/actions";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = { title: "Archive — Lidlr" };

export default async function ArchivePage() {
  const grouped = await prisma.leaflet.groupBy({
    by: ["countryCode"],
    _count: { _all: true },
    _max: { validFrom: true },
  });
  const stats = new Map(grouped.map((g) => [g.countryCode, g]));
  const countries = COUNTRIES.filter((c) => c.enabled && stats.has(c.code)).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", margin: "24px 0 4px" }}>
        <h1 style={{ margin: 0 }}>Leaflet archive</h1>
        <form action={fetchLeafletsAction}>
          <button className="button ghost" type="submit">
            Fetch latest leaflets
          </button>
        </form>
      </div>
      <p className="notice">
        Every week&apos;s national leaflet (&ldquo;folder / prospectus / folleto&rdquo;) for each crawled country is
        snapshotted here: the cover, validity dates and a full PDF copy stored on this server, so old deals stay
        readable even after Lidl removes them from their site.
      </p>

      {countries.length === 0 ? (
        <div className="empty">
          Nothing archived yet — hit &ldquo;Fetch latest leaflets&rdquo; or run{" "}
          <code>npm run leaflets -- --countries=PT,DE</code>.
        </div>
      ) : null}

      <div className="grid">
        {countries.map((c) => {
          const g = stats.get(c.code)!;
          const latest = g._max.validFrom;
          return (
            <Link key={c.code} href={`/archive/${c.code}`} className="card country-card">
              <div className="title">
                {c.name} <span className="badge">{c.code}</span>
              </div>
              <div className="meta">
                {g._count._all} leaflet{g._count._all === 1 ? "" : "s"}
                {latest ? ` · latest ${fmtDate(latest)}` : ""}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
