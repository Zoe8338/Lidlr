import Link from "next/link";
import { prisma } from "@/lib/db";
import { COUNTRIES } from "@/lib/lidl/catalog";
import { fetchLeafletsAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export const metadata = { title: "Archive — Lidlr" };

function fmtSize(bytes: number | null): string {
  if (!bytes) return "";
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtRange(from: Date | null, until: Date | null, fallback: string | null): string {
  if (from && until) return `${new Date(from).toLocaleDateString()} – ${new Date(until).toLocaleDateString()}`;
  return fallback ?? "";
}

export default async function ArchivePage() {
  const leaflets = await prisma.leaflet.findMany({
    orderBy: [{ countryCode: "asc" }, { validFrom: "desc" }],
  });

  const byCountry = new Map<string, typeof leaflets>();
  for (const lf of leaflets) {
    const list = byCountry.get(lf.countryCode) ?? [];
    list.push(lf);
    byCountry.set(lf.countryCode, list);
  }

  const enabled = COUNTRIES.filter((c) => c.enabled);

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
        Every week's national leaflet (&ldquo;folder / prospectus / folleto&rdquo;) for each crawled country is
        snapshotted here: the cover, validity dates and a full PDF copy stored on this server, so old deals stay
        readable even after Lidl removes them from their site.
      </p>

      {leaflets.length === 0 ? (
        <div className="empty">
          Nothing archived yet — hit &ldquo;Fetch latest leaflets&rdquo; or run{" "}
          <code>npm run leaflets -- --countries=PT,DE</code>.
        </div>
      ) : null}

      {enabled.map((c) => {
        const list = byCountry.get(c.code);
        if (!list?.length) return null;
        return (
          <section key={c.code} style={{ marginTop: 28 }}>
            <h2 className="section" style={{ marginBottom: 12 }}>
              {c.name} <span style={{ color: "var(--muted)", fontSize: 14 }}>· {list.length} leaflet{list.length > 1 ? "s" : ""}</span>
            </h2>
            <div className="grid">
              {list.map((lf) => (
                <div key={lf.id} className="card">
                  {lf.coverUrl ? <img src={lf.coverUrl} alt={lf.name} loading="lazy" /> : null}
                  <div className="title">{lf.name}</div>
                  <div className="meta">
                    {fmtRange(lf.validFrom, lf.validUntil, lf.title)}
                    {lf.pages ? ` · ${lf.pages} pages` : ""}
                    {lf.sizeBytes ? ` · ${fmtSize(lf.sizeBytes)}` : ""}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    {lf.pdfStored ? (
                      <Link className="button" href={`/api/leaflets/${lf.id}/pdf`} target="_blank">
                        Archived PDF
                      </Link>
                    ) : (
                      <span className="badge out">cover only</span>
                    )}
                    {(lf.viewUrl || lf.pdfUrl) ? (
                      <a className="button ghost" href={(lf.viewUrl ?? lf.pdfUrl)!} target="_blank" rel="noreferrer">
                        Lidl ↗
                      </a>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
