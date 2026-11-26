import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { currentUser, } from "@/lib/auth";
import { currentAdmin } from "@/lib/admin";
import { COUNTRIES } from "@/lib/lidl/catalog";
import { fmtDate } from "@/lib/format";
import { adminDeleteLeaflet, adminRunJob, adminSaveLeaflet, type AdminJobStatus } from "./actions";
import { readJobStatus } from "./job";

export const dynamic = "force-dynamic";

export const metadata = { title: "Admin — Lidlr", robots: { index: false, follow: false } };

const COUNTRIES_CODES = COUNTRIES.filter((c) => c.enabled).map((c) => c.code);

function JobStatusBox({ job }: { job: AdminJobStatus | null }) {
  if (!job) return null;
  const running = !job.finishedAt;
  return (
    <div className="notice" style={{ borderColor: running ? "var(--accent)" : job.ok ? "var(--ok, green)" : "crimson" }}>
      <strong>{running ? "Running" : job.ok ? "Finished" : "Failed"}</strong>: {job.name}
      {job.detail ? <pre style={{ whiteSpace: "pre-wrap", margin: "8px 0 0", fontSize: 12 }}>{job.detail}</pre> : null}
      <div style={{ fontSize: 12, opacity: 0.7 }}>
        started {fmtDate(job.startedAt)} {job.finishedAt ? `· finished ${fmtDate(job.finishedAt)}` : "· refresh this page for updates"}
      </div>
    </div>
  );
}

export default async function AdminPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/admin");
  const admin = await currentAdmin();
  // Signed in but not on the admin allowlist: 404 so the dashboard's
  // existence isn't advertised to non-admins.
  if (!admin) notFound();

  const [products, noTitle, noDesc, leaflets, offers, users, trackings, recent] = await Promise.all([
    prisma.product.count(),
    prisma.product.count({ where: { titleEn: null } }),
    prisma.product.count({ where: { description: null } }),
    prisma.leaflet.count(),
    prisma.leafletOffer.count(),
    prisma.user.count(),
    prisma.tracking.count(),
    prisma.leaflet.findMany({ orderBy: { fetchedAt: "desc" }, take: 40 }),
  ]);

  const countryRows = await prisma.country.findMany();
  const stateByCode = new Map(countryRows.map((c) => [c.code, c]));

  const job = readJobStatus();
  const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

  return (
    <div>
      <h1 style={{ margin: "24px 0 4px" }}>Admin dashboard</h1>
      <p className="notice">
        Signed in as <strong>{admin!.email}</strong>. Actions here run on the server immediately;
        background jobs (crawls, translations, image/manual passes) keep running after you close
        this page — refresh to see their status.
      </p>

      <JobStatusBox job={job} />

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

      <h2 style={{ marginTop: 32 }}>Maintenance jobs</h2>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
        <form action={adminRunJob} className="card" style={{ padding: 14, display: "grid", gap: 8 }}>
          <input type="hidden" name="job" value="crawl-all" />
          <strong>Crawl all storefronts</strong>
          <span className="meta">Full crawl of every enabled country (no leaflets; use the leaflets job for those).</span>
          <button className="button" type="submit">Start crawl (all)</button>
        </form>
        <form action={adminRunJob} className="card" style={{ padding: 14, display: "grid", gap: 8 }}>
          <input type="hidden" name="job" value="crawl-country" />
          <strong>Crawl one country</strong>
          <select name="cc" defaultValue="PT" className="input">
            {COUNTRIES_CODES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
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
          <select name="cc" defaultValue="PT" className="input">
            {COUNTRIES_CODES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <button className="button" type="submit">Fetch leaflets</button>
        </form>
        <form action={adminRunJob} className="card" style={{ padding: 14, display: "grid", gap: 8 }}>
          <input type="hidden" name="job" value="titles" />
          <strong>Translate missing titles</strong>
          <input className="input" name="max" type="number" placeholder="limit (default)" min={1} />
          <button className="button" type="submit">Run translation pass</button>
        </form>
        <form action={adminRunJob} className="card" style={{ padding: 14, display: "grid", gap: 8 }}>
          <input type="hidden" name="job" value="manuals" />
          <strong>Manuals + descriptions</strong>
          <input className="input" name="max" type="number" placeholder="limit (default 150)" min={1} />
          <button className="button" type="submit">Run manuals pass</button>
        </form>
        <form action={adminRunJob} className="card" style={{ padding: 14, display: "grid", gap: 8 }}>
          <input type="hidden" name="job" value="images" />
          <strong>Archive images</strong>
          <input className="input" name="max" type="number" placeholder="limit (default 400)" min={1} />
          <button className="button" type="submit">Run image pass</button>
        </form>
        <form action={adminRunJob} className="card" style={{ padding: 14, display: "grid", gap: 8 }}>
          <input type="hidden" name="job" value="reconcile" />
          <strong>Translation double-check</strong>
          <input className="input" name="max" type="number" placeholder="limit (default 400)" min={1} />
          <button className="button" type="submit">Run reconcile</button>
        </form>
        <form action={adminRunJob} className="card" style={{ padding: 14, display: "grid", gap: 8 }}>
          <input type="hidden" name="job" value="offers-eval" />
          <strong>Re-evaluate leaflet offers</strong>
          <span className="meta">Match stored leaflet offers against tracked products and queue notifications.</span>
          <button className="button" type="submit">Evaluate offers</button>
        </form>
      </div>

      <h2 style={{ marginTop: 32 }}>Crawler state per country</h2>
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

      <h2 style={{ marginTop: 32 }}>Leaflets — edit or delete (latest {recent.length})</h2>
      <p className="meta">Rename a leaflet, fix its validity dates (shown site-wide in dd/mm/yyyy), or remove it entirely (deletes its archived PDF and offers).</p>
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
    </div>
  );
}
