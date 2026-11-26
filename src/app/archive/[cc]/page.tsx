import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { COUNTRIES } from "@/lib/lidl/catalog";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function fmtSize(bytes: number | null): string {
  if (!bytes) return "";
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtRange(from: Date | null, until: Date | null, fallback: string | null): string {
  if (from && until)
    return `${fmtDate(from)} – ${fmtDate(until)}`;
  return fallback ?? "";
}

type Leaf = {
  id: number;
  name: string;
  title: string | null;
  validFrom: Date | null;
  validUntil: Date | null;
  coverUrl: string | null;
  pages: number | null;
  sizeBytes: number | null;
  pdfStored: boolean;
  viewUrl: string | null;
  pdfUrl: string | null;
  sha256: string | null;
  archivedAt: Date | null;
  fetchedAt: Date;
};

type MonthBucket = { key: string; year: number; month: number; leaflets: Leaf[] };

// A leaflet is filed under every calendar month its validity touches
// (e.g. 26/11 – 02/12 appears under November and December). Undated leaflets
// go to a fallback group at the bottom of the year list.
function bucketsFor(lf: Leaf): string[] {
  const from = lf.validFrom ? new Date(lf.validFrom) : null;
  const until = lf.validUntil ? new Date(lf.validUntil) : null;
  const anchor = from && !isNaN(from.getTime()) ? from : until && !isNaN(until.getTime()) ? until : null;
  if (!anchor) return ["undated"];
  const end = until && !isNaN(until.getTime()) ? until : anchor;
  const keys: string[] = [];
  const cur = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  for (let i = 0; i < 26 && cur <= last; i++) {
    keys.push(`${cur.getFullYear()}-${cur.getMonth()}`);
    cur.setMonth(cur.getMonth() + 1);
  }
  return keys.length ? keys : ["undated"];
}

export default async function CountryArchivePage({
  params,
  searchParams,
}: {
  params: Promise<{ cc: string }>;
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const { cc: rawCc } = await params;
  const cc = rawCc.toUpperCase();
  const country = COUNTRIES.find((c) => c.code === cc && c.enabled);
  if (!country) notFound();
  const sp = await searchParams;

  const rows: Leaf[] = await prisma.leaflet.findMany({
    where: { countryCode: cc },
    orderBy: [{ validFrom: "desc" }, { id: "desc" }],
  });

  const months = new Map<string, MonthBucket>();
  for (const lf of rows) {
    for (const key of bucketsFor(lf)) {
      const [y, m] = key === "undated" ? ["0000", "0"] : key.split("-");
      const entry = months.get(key) ?? { key, year: Number(y), month: Number(m), leaflets: [] };
      entry.leaflets.push(lf);
      months.set(key, entry);
    }
  }
  const monthList = [...months.values()].sort((a, b) =>
    b.year !== a.year ? b.year - a.year : b.month - a.month,
  );

  const selected =
    (sp.y && sp.m && monthList.find((x) => x.year === Number(sp.y) && x.month === Number(sp.m))) ||
    monthList[0] ||
    null;

  const years = [...new Set(monthList.map((x) => x.year))].sort((a, b) => b - a);

  return (
    <div style={{ padding: "24px 0" }}>
      <p style={{ margin: "0 0 6px" }}>
        <Link href="/archive">← All countries</Link>
      </p>
      <h1 style={{ margin: "0 0 6px" }}>
        {country.name} <span style={{ color: "var(--muted)", fontSize: 16 }}>· weekly leaflet archive</span>
      </h1>
      <p className="notice" style={{ marginTop: 10 }}>
        {rows.length} leaflet{rows.length === 1 ? "" : "s"} archived. Pick a month to see that month&apos;s weekly
        leaflets.
      </p>

      <div className="archive-layout">
        <nav className="archive-nav" aria-label="Archive months">
          {years.length === 0 ? <div className="empty">Nothing archived yet for {country.name}.</div> : null}
          {years.map((y) => (
            <div key={y} className="archive-year">
              <div className="archive-year-label">{y === 0 ? "Undated" : y}</div>
              <ul className="archive-months">
                {monthList
                  .filter((x) => x.year === y)
                  .map((x) => (
                    <li key={x.key}>
                      <Link
                        href={`/archive/${cc}?y=${x.year}&m=${x.month}`}
                        className={selected?.key === x.key ? "active" : ""}
                        prefetch={false}
                      >
                        {x.year === 0 ? "Undated" : MONTHS[x.month]}
                        <span className="count">{x.leaflets.length}</span>
                      </Link>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="archive-content">
          {selected ? (
            <>
              <h2 className="section" style={{ marginTop: 0 }}>
                {selected.year === 0
                  ? "Undated leaflets"
                  : `${MONTHS[selected.month]} ${selected.year}`}
              </h2>
              <div className="grid">
                {selected.leaflets.map((lf) => (
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
                        <Link
                          className="button"
                          // content-versioned URL: replacing/attaching the PDF in
                          // admin changes the version, so browsers immediately
                          // fetch the new document instead of a cached copy
                          href={`/api/leaflets/${lf.id}/pdf?v=${(lf.sha256 ?? lf.archivedAt?.toISOString() ?? lf.fetchedAt.toISOString()).slice(0, 12)}`}
                          target="_blank"
                        >
                          Archived PDF
                        </Link>
                      ) : (
                        <span className="badge out">cover only</span>
                      )}
                      {lf.viewUrl || lf.pdfUrl ? (
                        <a className="button ghost" href={(lf.viewUrl ?? lf.pdfUrl)!} target="_blank" rel="noreferrer">
                          Lidl ↗
                        </a>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
