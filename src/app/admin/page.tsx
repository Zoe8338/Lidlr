import Link from "next/link";
import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { currentAdmin } from "@/lib/admin";
import { COUNTRIES } from "@/lib/lidl/catalog";
import { fmtDate } from "@/lib/format";
import { adminDeleteLeaflet, adminRunJob, adminSaveLeaflet, type AdminJobStatus } from "./actions";
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

async function Leaflets() {
  const recent = await prisma.leaflet.findMany({ orderBy: { fetchedAt: "desc" }, take: 40 });
  const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
  return (
    <>
      <p className="meta">
        Rename a leaflet, fix its validity dates (shown site-wide in dd/mm/yyyy), or delete it
        entirely (removes its archived PDF and offers). Showing the latest {recent.length}.
      </p>
      <div style={{ display: "grid", gap: 12 }}>
        {recent.map((l) => (
          <form key={l.id} action={adminSaveLeaflet} className="card" style={{ padding: 14, display: "grid", gap: 8, gridTemplateColumns: "1.4fr 1fr 1fr 1fr auto auto", alignItems: "end" }}>
            <input type="hidden" name="id" value={l.id} />
            <label className="meta">
              {l.countryCode} · {l.flyerId.slice(0, 8)}…
              <input className="input" name="name" defaultValue={l.name} style={{ width: "100%" }} />
            </label>
            <label className="meta">
              title
              <input className="input" name="title" defaultValue={l.title ?? ""} style={{ width: "100%" }} />
            </label>
            <label className="meta">
              valid from
              <input className="input" name="validFrom" type="date" defaultValue={iso(l.validFrom)} style={{ width: "100%" }} />
            </label>
            <label className="meta">
              valid until
              <input className="input" name="validUntil" type="date" defaultValue={iso(l.validUntil)} style={{ width: "100%" }} />
            </label>
            <button className="button" type="submit">Save</button>
            <button className="button ghost" type="submit" formAction={adminDeleteLeaflet}>Delete</button>
          </form>
        ))}
      </div>
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
  searchParams: Promise<{ tab?: string; q?: string }>;
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
      {tab === "leaflets" ? <Leaflets /> : null}
      {tab === "products" ? <Products q={q} /> : null}
    </div>
  );
}
