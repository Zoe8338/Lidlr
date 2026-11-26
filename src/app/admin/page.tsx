import Link from "next/link";
import type { CSSProperties } from "react";
import fs from "node:fs";
import path from "node:path";
import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { currentAdmin } from "@/lib/admin";
import { COUNTRIES } from "@/lib/lidl/catalog";
import { fmtDate } from "@/lib/format";
import {
  adminAttachServerPdf,
  adminCreateLeaflet,
  adminDeleteLeaflet,
  adminRunJob,
  adminSaveLeaflet,
  adminUploadLeafletPdf,
  type AdminJobStatus,
} from "./actions";
import { readJobStatus } from "./job";
import { readFlash } from "./flash";
import {
  adminDeleteProduct,
  adminRefetchDetails,
  adminResetTranslations,
  adminRetranslateProduct,
  adminSaveProduct,
} from "./productActions";

export const dynamic = "force-dynamic";

export const metadata = { title: "Admin — Lidlr", robots: { index: false, follow: false } };

const TABS = [
  ["overview", "Overview"],
  ["jobs", "Jobs"],
  ["leaflets", "Leaflets"],
  ["products", "Products"],
] as const;

const COUNTRIES_CODES = COUNTRIES.filter((c) => c.enabled).map((c) => c.code);

function Tabs({ active }: { active: string }) {
  return (
    <nav className="admin-tabs">
      {TABS.map(([id, label]) => (
        <Link
          key={id}
          href={`/admin?tab=${id}`}
          className="admin-tab"
          style={
            active === id
              ? { background: "var(--accent)", color: "var(--on-accent, #fff)", borderColor: "transparent" }
              : undefined
          }
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

function Flash() {
  const flash = readFlash();
  if (!flash) return null;
  return (
    <div className="notice" style={{ borderColor: flash.ok ? "var(--accent)" : "crimson" }}>
      {flash.ok ? "✓ " : "✗ "}
      {flash.message}
    </div>
  );
}

function JobStatusBox({ job }: { job: AdminJobStatus | null }) {
  if (!job) return null;
  const running = !job.finishedAt;
  return (
    <div className="notice" style={{ borderColor: running ? "var(--accent)" : job.ok ? "var(--accent)" : "crimson" }}>
      <strong>{running ? "Running" : job.ok ? "Finished" : "Failed"}</strong>: {job.name}
      {job.detail ? <pre style={{ whiteSpace: "pre-wrap", margin: "8px 0 0", fontSize: 12 }}>{job.detail}</pre> : null}
      <div style={{ fontSize: 12, opacity: 0.7 }}>
        started {fmtDate(job.startedAt)} {job.finishedAt ? `· finished ${fmtDate(job.finishedAt)}` : "· refresh this page for updates"}
      </div>
    </div>
  );
}

async function Overview() {
  const [products, noTitle, noDesc, leaflets, offers, users, trackings, countryRows] = await Promise.all([
    prisma.product.count(),
    prisma.product.count({ where: { titleEn: null } }),
    prisma.product.count({ where: { description: null } }),
    prisma.leaflet.count(),
    prisma.leafletOffer.count(),
    prisma.user.count(),
    prisma.tracking.count(),
    prisma.country.findMany(),
  ]);
  const stateByCode = new Map(countryRows.map((c) => [c.code, c]));
  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
        {[
          ["Products", products],
          ["Missing titles EN", noTitle],
          ["Missing description", noDesc],
          ["Leaflets", leaflets],
          ["Leaflet offers", offers],
          ["Users", users],
          ["Trackings", trackings],
        ].map(([label, n]) => (
          <div key={String(label)} className="card" style={{ padding: 14 }}>
            <div className="meta">{label}</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{n as number}</div>
          </div>
        ))}
      </div>
      <h2 style={{ marginTop: 24 }}>Crawler state per country</h2>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
        {COUNTRIES.filter((c) => c.enabled).map((c) => {
          const s = stateByCode.get(c.code);
          return (
            <div key={c.code} className="card" style={{ padding: 14 }}>
              <div className="title">{c.name} <span className="badge">{c.code}</span></div>
              <div className="meta">
                last crawl: {s?.lastCrawledAt ? fmtDate(s.lastCrawledAt) : "never"}
                <br />
                last leaflets: {s?.lastLeafletAt ? fmtDate(s.lastLeafletAt) : "never"}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function Jobs() {
  const countrySelect = (
    <select name="cc" defaultValue="PT" className="input">
      {COUNTRIES_CODES.map((c) => (
        <option key={c} value={c}>{c}</option>
      ))}
    </select>
  );
  const limitInput = (placeholder: string) => (
    <input className="input" name="max" type="number" placeholder={placeholder} min={1} />
  );
  return (
    <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
      <form action={adminRunJob} className="card" style={{ padding: 14, display: "grid", gap: 8 }}>
        <input type="hidden" name="job" value="crawl-all" />
        <strong>Crawl all storefronts</strong>
        <span className="meta">Full crawl of every enabled country (leaflets are fetched separately or by the scheduler).</span>
        <button className="button" type="submit">Start crawl (all)</button>
      </form>
      <form action={adminRunJob} className="card" style={{ padding: 14, display: "grid", gap: 8 }}>
        <input type="hidden" name="job" value="crawl-country" />
        <strong>Crawl one country</strong>
        {countrySelect}
        <button className="button" type="submit">Start crawl</button>
      </form>
      <form action={adminRunJob} className="card" style={{ padding: 14, display: "grid", gap: 8 }}>
        <input type="hidden" name="job" value="leaflets-all" />
        <strong>Fetch leaflets — all countries</strong>
        <span className="meta">Discover + archive new leaflet PDFs for every storefront.</span>
        <button className="button" type="submit">Fetch leaflets (all)</button>
      </form>
      <form action={adminRunJob} className="card" style={{ padding: 14, display: "grid", gap: 8 }}>
        <input type="hidden" name="job" value="leaflets-country" />
        <strong>Fetch leaflets — one country</strong>
        {countrySelect}
        <button className="button" type="submit">Fetch leaflets</button>
      </form>
      <form action={adminRunJob} className="card" style={{ padding: 14, display: "grid", gap: 8 }}>
        <input type="hidden" name="job" value="titles" />
        <strong>Translate missing titles</strong>
        {limitInput("limit (default 500)")}
        <button className="button" type="submit">Run translation pass</button>
      </form>
      <form action={adminRunJob} className="card" style={{ padding: 14, display: "grid", gap: 8 }}>
        <input type="hidden" name="job" value="manuals" />
        <strong>Manuals + descriptions</strong>
        {limitInput("limit (default 150)")}
        <button className="button" type="submit">Run manuals pass</button>
      </form>
      <form action={adminRunJob} className="card" style={{ padding: 14, display: "grid", gap: 8 }}>
        <input type="hidden" name="job" value="images" />
        <strong>Archive images</strong>
        {limitInput("limit (default 400)")}
        <button className="button" type="submit">Run image pass</button>
      </form>
      <form action={adminRunJob} className="card" style={{ padding: 14, display: "grid", gap: 8 }}>
        <input type="hidden" name="job" value="reconcile" />
        <strong>Translation double-check</strong>
        {limitInput("limit (default 400)")}
        <button className="button" type="submit">Run reconcile</button>
      </form>
      <form action={adminRunJob} className="card" style={{ padding: 14, display: "grid", gap: 8 }}>
        <input type="hidden" name="job" value="offers-eval" />
        <strong>Re-evaluate leaflet offers</strong>
        <span className="meta">Match stored leaflet offers against tracked products and queue notifications.</span>
        <button className="button" type="submit">Evaluate offers</button>
      </form>
    </div>
  );
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function dataDir(): string {
  return path.resolve(process.env.DATA_DIR || "data");
}

function isoDate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

function isoDateTime(d: Date | null): string {
  return d ? d.toISOString().slice(0, 16) : "";
}

function fmtSize(bytes: number | null): string {
  return bytes ? ` · ${(bytes / 1024 / 1024).toFixed(1)} MB` : "";
}

type LeafletRow = Awaited<ReturnType<typeof prisma.leaflet.findMany>>[number];

const fieldGrid: CSSProperties = { display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" };

function LeafletFields({ l, countryCode }: { l?: LeafletRow; countryCode: string }) {
  return (
    <div style={fieldGrid}>
      <label className="meta">country
        <select className="input" name="countryCode" defaultValue={l?.countryCode ?? countryCode} style={{ width: "100%" }}>
          {COUNTRIES.filter((c) => c.enabled).map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
        </select>
      </label>
      <label className="meta">name * (shown in lists)
        <input className="input" name="name" defaultValue={l?.name ?? ""} required style={{ width: "100%" }} />
      </label>
      <label className="meta">title (e.g. Natal / Christmas)
        <input className="input" name="title" defaultValue={l?.title ?? ""} style={{ width: "100%" }} />
      </label>
      <label className="meta">flyer ID {l ? "(moving the archived PDF follows this)" : "(blank = auto-generate)"}
        <input className="input" name="flyerId" defaultValue={l?.flyerId ?? ""} style={{ width: "100%" }} />
      </label>
      <label className="meta">valid from
        <input className="input" name="validFrom" type="date" defaultValue={isoDate(l?.validFrom ?? null)} style={{ width: "100%" }} />
      </label>
      <label className="meta">valid until
        <input className="input" name="validUntil" type="date" defaultValue={isoDate(l?.validUntil ?? null)} style={{ width: "100%" }} />
      </label>
      <label className="meta">cover image URL
        <input className="input" name="coverUrl" defaultValue={l?.coverUrl ?? ""} style={{ width: "100%" }} />
      </label>
      <label className="meta">source PDF URL
        <input className="input" name="pdfUrl" defaultValue={l?.pdfUrl ?? ""} style={{ width: "100%" }} />
      </label>
      <label className="meta">view URL (Lidl flyer page)
        <input className="input" name="viewUrl" defaultValue={l?.viewUrl ?? ""} style={{ width: "100%" }} />
      </label>
      <label className="meta">pages
        <input className="input" name="pages" type="number" min={0} defaultValue={l?.pages ?? ""} style={{ width: "100%" }} />
      </label>
      <label className="meta">size (bytes)
        <input className="input" name="sizeBytes" type="number" min={0} defaultValue={l?.sizeBytes ?? ""} style={{ width: "100%" }} />
      </label>
      <label className="meta">sha256 (blank = recompute on PDF change)
        <input className="input" name="sha256" defaultValue={l?.sha256 ?? ""} style={{ width: "100%" }} />
      </label>
      <label className="meta">fetched at
        <input className="input" name="fetchedAt" type="datetime-local" defaultValue={isoDateTime(l?.fetchedAt ?? null)} style={{ width: "100%" }} />
      </label>
      <label className="meta">archived at
        <input className="input" name="archivedAt" type="datetime-local" defaultValue={isoDateTime(l?.archivedAt ?? null)} style={{ width: "100%" }} />
      </label>
      <label className="check">
        <input type="checkbox" name="pdfStored" defaultChecked={l?.pdfStored ?? false} />
        PDF archived on server
      </label>
    </div>
  );
}

async function Leaflets({ cc }: { cc: string | null }) {
  // Country buttons first (like the public archive page), then the chosen
  // country's leaflets grouped by year → month.
  if (!cc) {
    const grouped = await prisma.leaflet.groupBy({ by: ["countryCode"], _count: { _all: true } });
    const counts = new Map(grouped.map((g) => [g.countryCode, g._count._all]));
    return (
      <>
        <p className="meta">Pick a storefront to manage its archived leaflets.</p>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))" }}>
          {COUNTRIES.filter((c) => c.enabled).map((c) => {
            const n = counts.get(c.code) ?? 0;
            return (
              <Link
                key={c.code}
                href={`/admin?tab=leaflets&cc=${c.code}`}
                className="card country-card"
                style={n === 0 ? { opacity: 0.55 } : undefined}
              >
                <div className="title">
                  {c.name} <span className="badge">{c.code}</span>
                </div>
                <div className="meta">{n} leaflet{n === 1 ? "" : "s"}{n === 0 ? " — nothing archived yet" : ""}</div>
              </Link>
            );
          })}
        </div>
      </>
    );
  }

  const country = COUNTRIES.find((c) => c.code === cc);
  const leaflets = await prisma.leaflet.findMany({
    where: { countryCode: cc },
    orderBy: [{ validFrom: "desc" }, { fetchedAt: "desc" }],
  });

  // PDFs sitting in the country's folder that no leaflet row claims.
  const inUse = new Set(leaflets.filter((l) => l.pdfStored).map((l) => `${l.flyerId}.pdf`));
  const dir = path.join(dataDir(), "leaflets", cc);
  const orphans = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith(".pdf") && !inUse.has(f)).sort()
    : [];

  // Group by the month each leaflet starts in (year → month), newest first —
  // mirrors the public archive page's structure.
  const years = new Map<number, Map<number, LeafletRow[]>>();
  for (const l of leaflets) {
    const anchor = l.validFrom ?? l.validUntil ?? l.fetchedAt;
    const y = anchor.getFullYear();
    const m = anchor.getMonth();
    if (!years.has(y)) years.set(y, new Map());
    const months = years.get(y)!;
    if (!months.has(m)) months.set(m, []);
    months.get(m)!.push(l);
  }
  const sortedYears = [...years.keys()].sort((a, b) => b - a);
  const orphanSelect = (label: string) => (
    <label className="meta">
      {label}
      <select className="input" name="src" style={{ width: "100%" }}>
        {orphans.map((f) => <option key={f} value={f}>{f}</option>)}
      </select>
    </label>
  );

  return (
    <>
      <p style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <Link href="/admin?tab=leaflets" className="button ghost">← All countries</Link>
        <strong>{country?.name ?? cc}</strong>
        <span className="meta">{leaflets.length} leaflet{leaflets.length === 1 ? "" : "s"}{orphans.length ? ` · ${orphans.length} unclaimed PDF(s) on the server` : ""}</span>
      </p>

      <h2>Add a leaflet</h2>
      <form action={adminCreateLeaflet} className="card" style={{ padding: 16, display: "grid", gap: 10 }}>
        <LeafletFields countryCode={cc} />
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
          {orphans.length ? orphanSelect("…or attach a PDF already on the server instead of uploading") : null}
          <label className="meta">…and/or upload a PDF now
            <input className="input" type="file" name="pdf" accept="application/pdf" />
          </label>
          <button className="button" type="submit">Create leaflet</button>
        </div>
      </form>

      {sortedYears.map((y) => (
        <div key={y}>
          <h2 style={{ marginTop: 24 }}>{y}</h2>
          {[...years.get(y)!.keys()].sort((a, b) => b - a).map((m) => (
            <div key={m} style={{ marginTop: 12 }}>
              <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>{MONTHS[m]}</h3>
              <div style={{ display: "grid", gap: 14 }}>
                {years.get(y)!.get(m)!.map((l) => (
                  <div key={l.id} className="card" style={{ padding: 16, display: "grid", gap: 10 }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                      <strong>#{l.id}</strong>
                      <span>{l.name}{l.title ? ` — ${l.title}` : ""}</span>
                      <span className="meta">
                        {l.validFrom && l.validUntil ? `${fmtDate(l.validFrom)} – ${fmtDate(l.validUntil)}` : "undated"}
                        {fmtSize(l.sizeBytes)}
                        {l.pdfStored ? (fs.existsSync(path.join(dir, `${l.flyerId}.pdf`)) ? " · PDF on server ✓" : " · PDF MISSING on server") : " · no archived PDF"}
                      </span>
                      {l.pdfStored ? <a className="meta" href={`/api/leaflets/${l.id}/pdf`} target="_blank">view PDF ↗</a> : null}
                    </div>
                    <form action={adminSaveLeaflet} style={{ display: "grid", gap: 10 }}>
                      <input type="hidden" name="id" value={l.id} />
                      <LeafletFields l={l} countryCode={cc} />
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button className="button" type="submit">Save all fields</button>
                        <button className="button ghost" type="submit" formAction={adminDeleteLeaflet} style={{ color: "crimson", borderColor: "crimson" }}>Delete leaflet</button>
                      </div>
                    </form>
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end", borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                      <form action={adminUploadLeafletPdf} style={{ display: "grid", gap: 6 }}>
                        <input type="hidden" name="id" value={l.id} />
                        <label className="meta">upload / replace archived PDF
                          <input className="input" type="file" name="pdf" accept="application/pdf" />
                        </label>
                        <button className="button ghost" type="submit">Upload PDF</button>
                      </form>
                      {orphans.length ? (
                        <form action={adminAttachServerPdf} style={{ display: "grid", gap: 6 }}>
                          <input type="hidden" name="id" value={l.id} />
                          {orphanSelect("attach a PDF already on the server")}
                          <button className="button ghost" type="submit">Attach</button>
                        </form>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
      {leaflets.length === 0 ? <div className="empty">Nothing archived for {cc} yet — use the form above to add one, or run a leaflet fetch from the Jobs tab.</div> : null}
    </>
  );
}

async function Products({ q }: { q: string }) {
  const results = q
    ? await prisma.product.findMany({
        where: {
          OR: [
            { erpNumber: { contains: q } },
            { title: { contains: q } },
            { titleEn: { contains: q } },
            { brandName: { contains: q } },
          ],
        },
        orderBy: { lastSeen: "desc" },
        take: 5,
      })
    : [];
  return (
    <>
      <form method="get" action="/admin" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input type="hidden" name="tab" value="products" />
        <input className="input" type="search" name="q" defaultValue={q} placeholder="Search by ERP number, title or brand…" style={{ flex: "1 1 320px" }} />
        <button className="button" type="submit">Search</button>
      </form>
      {q && results.length === 0 ? <div className="empty">No products match &ldquo;{q}&rdquo;.</div> : null}
      <div style={{ display: "grid", gap: 16, marginTop: 16 }}>
        {results.map((p) => (
          <div key={p.erpNumber} className="card" style={{ padding: 16 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              <strong>{p.erpNumber}</strong>
              <Link href={`/products/${p.erpNumber}`} className="meta">open product page ↗</Link>
            </div>
            <form action={adminSaveProduct} style={{ display: "grid", gap: 10, marginTop: 10 }}>
              <input type="hidden" name="erp" value={p.erpNumber} />
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
                <label className="meta">title (original)
                  <input className="input" name="title" defaultValue={p.title} style={{ width: "100%" }} />
                </label>
                <label className="meta">title (English)
                  <input className="input" name="titleEn" defaultValue={p.titleEn ?? ""} style={{ width: "100%" }} />
                </label>
              </div>
              <label className="meta">brand
                <input className="input" name="brandName" defaultValue={p.brandName ?? ""} style={{ width: "100%" }} />
              </label>
              <label className="meta">description (original)
                <textarea className="input" name="description" defaultValue={p.description ?? ""} rows={3} style={{ width: "100%" }} />
              </label>
              <label className="meta">description (English)
                <textarea className="input" name="descriptionEn" defaultValue={p.descriptionEn ?? ""} rows={3} style={{ width: "100%" }} />
              </label>
              <label className="meta">specs (original)
                <textarea className="input" name="specs" defaultValue={p.specs ?? ""} rows={3} style={{ width: "100%" }} />
              </label>
              <label className="meta">specs (English)
                <textarea className="input" name="specsEn" defaultValue={p.specsEn ?? ""} rows={3} style={{ width: "100%" }} />
              </label>
              <label className="check">
                <input type="checkbox" name="removed" defaultChecked={p.removed} />
                mark as removed (hides it from the catalog without deleting history)
              </label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="button" type="submit">Save fields</button>
                <button className="button ghost" type="submit" formAction={adminRetranslateProduct}>Force re-translate now</button>
                <button className="button ghost" type="submit" formAction={adminResetTranslations}>Clear translations (re-translate later)</button>
                <button className="button ghost" type="submit" formAction={adminRefetchDetails}>Re-fetch description + manuals from Lidl</button>
              </div>
            </form>
            <form action={adminDeleteProduct} style={{ marginTop: 8 }}>
              <input type="hidden" name="erp" value={p.erpNumber} />
              <button className="button ghost" type="submit" style={{ color: "crimson", borderColor: "crimson" }}>
                Delete product entirely
              </button>
            </form>
          </div>
        ))}
      </div>
    </>
  );
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; cc?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login?next=/admin");
  const admin = await currentAdmin();
  // Signed in but not on the admin allowlist: 404 so the dashboard's
  // existence isn't advertised to non-admins.
  if (!admin) notFound();

  const sp = await searchParams;
  const tab = TABS.some(([id]) => id === sp.tab) ? sp.tab! : "overview";
  const q = (sp.q || "").trim().slice(0, 120);
  const cc = /^[A-Z]{2}$/.test(sp.cc || "") ? sp.cc! : null;

  return (
    <div>
      <h1 style={{ margin: "24px 0 4px" }}>Admin dashboard</h1>
      <p className="meta">
        Signed in as <strong>{admin.email}</strong>. Background jobs keep running on the server after
        you leave this page.
      </p>
      <Tabs active={tab} />
      <Flash />
      {tab === "overview" ? (
        <>
          <JobStatusBox job={readJobStatus()} />
          <Overview />
        </>
      ) : null}
      {tab === "jobs" ? (
        <>
          <JobStatusBox job={readJobStatus()} />
          <Jobs />
        </>
      ) : null}
      {tab === "leaflets" ? <Leaflets cc={cc} /> : null}
      {tab === "products" ? <Products q={q} /> : null}
    </div>
  );
}
