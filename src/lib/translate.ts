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
async function batchRequest(lines: string[]): Promise<string[] | null> {
  try {
    const r = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${TARGET}&dt=t`, {
      method: "POST",
      headers: { "user-agent": "Mozilla/5.0", "content-type": "application/x-www-form-urlencoded" },
      body: "q=" + encodeURIComponent(lines.join("\n")),
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) throw new Error(String(r.status));
    const j = (await r.json()) as unknown;
    const segs = Array.isArray(j) && Array.isArray(j[0]) ? j[0] : [];
    if (!Array.isArray(segs) || segs.length !== lines.length) return null;
    return segs.map((s) => (Array.isArray(s) ? String(s[0] ?? "").replace(/\n$/, "").trim() : ""));
  } catch (e) {
    const now = Date.now();
    if (now - lastWarn > 60000) {
      console.warn(
        `[translate] request failed (${e instanceof Error ? e.message : e}) — keeping original titles; retried next crawl.`,
      );
      lastWarn = now;
    }
    return null;
  }
}

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
    await new Promise((r) => setTimeout(r, 150));
  }
  return result;
}

export async function translateTitle(raw: string): Promise<string | null> {
  if (!translationEnabled() || !raw?.trim()) return null;
  const m = await translateTitles([raw]);
  return m.get(raw.trim()) ?? null;
}
