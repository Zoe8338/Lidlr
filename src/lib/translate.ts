const TARGET = process.env.TRANSLATE_TARGET || "en";
const CACHE = new Map<string, string | null>();
const BATCH = 40;
let lastWarn = 0;

export function translationEnabled() {
  return process.env.AUTO_TRANSLATE === "1";
}

// Free community translation endpoint (no key). Titles are batched several per
// request (one line each); the response returns one segment per input line.
// Failures are logged (throttled) and degrade silently: originals are kept and
// retried on the next crawl — anything cached as failed is retried per process.
function warnOnce(msg: string) {
  const now = Date.now();
  if (now - lastWarn > 60000) {
    console.warn(`[translate] ${msg}`);
    lastWarn = now;
  }
}

async function batchRequest(lines: string[]): Promise<string[] | null> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${TARGET}&dt=t`, {
        method: "POST",
        headers: { "user-agent": "Mozilla/5.0", "content-type": "application/x-www-form-urlencoded" },
        body: "q=" + encodeURIComponent(lines.join("\n")),
        signal: AbortSignal.timeout(12000),
      });
      if (r.status === 429 || r.status >= 500) {
        if (r.status === 429 && pace < MAX_PACE) pace = Math.min(MAX_PACE, pace * 4);
        if (attempt === 3) {
          warnOnce(`rate-limited (${r.status}) — keeping original titles; will retry on the next crawl/backfill.`);
          return null;
        }
        await new Promise((res) => setTimeout(res, attempt * 4000));
        continue;
      }
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as unknown;
      const segs = Array.isArray(j) && Array.isArray(j[0]) ? j[0] : [];
      if (!Array.isArray(segs) || segs.length !== lines.length) return null;
      return segs.map((s) => (Array.isArray(s) ? String(s[0] ?? "").replace(/\n$/, "").trim() : ""));
    } catch (e) {
      warnOnce(
        `request failed (${e instanceof Error ? e.message : e}) — keeping original titles; retried next crawl.`,
      );
      return null;
    }
  }
  return null;
}

let pace = 400;
const MAX_PACE = 5000;

export async function translateTitles(titles: string[]): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  if (!translationEnabled()) return result;

  const pending: string[] = [];
  const seen = new Set<string>();
  for (const t of titles) {
    const key = (t ?? "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (CACHE.has(key)) result.set(key, CACHE.get(key) ?? null);
    else pending.push(key);
  }

  for (let i = 0; i < pending.length; i += BATCH) {
    const chunk = pending.slice(i, i + BATCH);
    const out = await batchRequest(chunk.map((t) => t.slice(0, 300)));
    if (out) {
      chunk.forEach((t, k) => {
        const v = out[k]?.trim() || null;
        CACHE.set(t, v);
        result.set(t, v);
      });
    } else {
      for (const t of chunk) {
        CACHE.set(t, null);
        result.set(t, null);
      }
    }
    if (i + BATCH < pending.length) await new Promise((r) => setTimeout(r, pace));
  }
  return result;
}

export async function translateTitle(raw: string): Promise<string | null> {
  if (!translationEnabled() || !raw?.trim()) return null;
  const m = await translateTitles([raw]);
  return m.get(raw.trim()) ?? null;
}

// Free-form text (descriptions): Google splits long inputs into several
// segments, so the response segments are joined in order instead of matched
// one-to-one like translateTitles does.
export async function translateText(text: string): Promise<string | null> {
  if (!translationEnabled()) return null;
  const t = text.trim();
  if (!t) return null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${TARGET}&dt=t`, {
        method: "POST",
        headers: { "user-agent": "Mozilla/5.0", "content-type": "application/x-www-form-urlencoded" },
        body: "q=" + encodeURIComponent(t.slice(0, 2000)),
        signal: AbortSignal.timeout(15000),
      });
      if (r.status === 429 || r.status >= 500) {
        if (attempt === 3) return null;
        await new Promise((res) => setTimeout(res, attempt * 4000));
        continue;
      }
      if (!r.ok) return null;
      const j = (await r.json()) as unknown;
      const segs = Array.isArray(j) && Array.isArray(j[0]) ? j[0] : [];
      if (!segs.length) return null;
      return segs.map((s) => (Array.isArray(s) ? String(s[0] ?? "") : "")).join("").replace(/\n+/g, " ").trim() || null;
    } catch {
      return null;
    }
  }
  return null;
}
