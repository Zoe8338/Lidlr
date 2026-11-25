const TARGET = process.env.TRANSLATE_TARGET || "en";
const CACHE = new Map<string, string | null>();
const BATCH = 40;
let lastWarn = 0;

export function translationEnabled() {
  return process.env.AUTO_TRANSLATE === "1";
}

// Translation chain: the two/three free Google endpoints first (rotating on
// rate limits — they are throttled per-endpoint/per-IP, so a 429 on one often
// succeeds on the next), then the bundled LibreTranslate sidecar as the
// last-resort "finisher" that completes whatever Google refuses. The "single"
// endpoint returns one segment per input line; the "t" endpoints return all
// lines joined with \n (we split it back). Failures degrade silently:
// originals are kept and retried later, and reconcileTranslations (24 h
// cadence) re-checks stored values against Google.
function warnOnce(msg: string) {
  const now = Date.now();
  if (now - lastWarn > 60000) {
    console.warn(`[translate] ${msg}`);
    lastWarn = now;
  }
}

const LIBRE_URL = process.env.LIBRETRANSLATE_URL?.trim().replace(/\/$/, "");
const LIBRE_KEY = process.env.LIBRETRANSLATE_API_KEY?.trim() || undefined;

const ENDPOINTS = [
  { style: "single" as const, url: `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${TARGET}&dt=t`, method: "POST" as const },
  { style: "t" as const, url: `https://translate.googleapis.com/translate_a/t?client=gtx&sl=auto&tl=${TARGET}`, method: "GET" as const },
  { style: "t" as const, url: `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=${TARGET}`, method: "GET" as const },
  ...(LIBRE_URL
    ? [{ style: "libre" as const, url: `${LIBRE_URL}/translate`, method: "POST" as const }]
    : []),
];
const LIBRE_IDX = ENDPOINTS.findIndex((e) => e.style === "libre");
const GOOGLE_LAST = LIBRE_IDX >= 0 ? LIBRE_IDX - 1 : ENDPOINTS.length - 1;
let endpoint = 0;

let pace = 800;
const MAX_PACE = 8000;
const WAITS = [5000, 10000, 30000, 60000, 120000, 300000];

function parseJoined(j: unknown, n: number): string[] | null {
  // [["a\nb\nc","de"]] -> ["a","b","c"] (also handles ["a\nb\nc"] shapes)
  let joined: string | null = null;
  if (Array.isArray(j) && Array.isArray(j[0]) && typeof j[0][0] === "string") joined = j[0][0];
  else if (Array.isArray(j) && typeof j[0] === "string") joined = j[0];
  if (joined == null) return null;
  const parts = joined.split("\n").map((s) => s.trim()).filter(Boolean);
  return parts.length === n ? parts : null;
}

function parseSegments(j: unknown, n: number): string[] | null {
  const segs = Array.isArray(j) && Array.isArray(j[0]) ? j[0] : [];
  if (!Array.isArray(segs) || segs.length !== n) return null;
  return segs.map((s) => (Array.isArray(s) ? String(s[0] ?? "").replace(/\n$/, "").trim() : ""));
}

// LibreTranslate /translate: { q: string | string[], source: "auto", target, format: "text" }
// -> { translatedText: string | string[] }
function parseLibre(j: unknown, perLine: number | null): string[] | string | null {
  const t = (j as { translatedText?: unknown } | null)?.translatedText;
  if (perLine != null) {
    if (Array.isArray(t) && t.length === perLine && t.every((x) => typeof x === "string")) {
      return (t as string[]).map((s) => s.trim());
    }
    if (typeof t === "string") {
      const parts = t.split("\n").map((s) => s.trim()).filter(Boolean);
      return parts.length === perLine ? parts : null;
    }
    return null;
  }
  if (typeof t === "string") return t;
  if (Array.isArray(t) && t.every((x) => typeof x === "string")) {
    return (t as string[]).join(" ").replace(/\s+/g, " ").trim();
  }
  return null;
}

async function translateOnce(
  q: string,
  perLine: number | null,
): Promise<string[] | string | null> {
  const ep = ENDPOINTS[endpoint];
  if (ep.style === "libre") {
    const r = await fetch(ep.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        q: perLine != null ? q.split("\n") : q,
        source: "auto",
        target: TARGET,
        format: "text",
        ...(LIBRE_KEY ? { api_key: LIBRE_KEY } : {}),
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (r.status === 429 || r.status >= 500) throw Object.assign(new Error(`http:${r.status}`), { rate: true });
    if (!r.ok) throw Object.assign(new Error(`http:${r.status}`), { rate: false });
    const j = (await r.json()) as unknown;
    const out = parseLibre(j, perLine);
    if (out) return out;
    throw Object.assign(new Error("shape"), { rate: false });
  }
  const body = ep.style === "single" ? "q=" + encodeURIComponent(q) : undefined;
  const url = ep.style === "single" ? ep.url : `${ep.url}&q=${encodeURIComponent(q)}`;
  const r = await fetch(url, {
    method: ep.method,
    headers: { "user-agent": "Mozilla/5.0", "content-type": "application/x-www-form-urlencoded" },
    ...(body ? { body } : {}),
    signal: AbortSignal.timeout(15000),
  });
  if (r.status === 429 || r.status >= 500) throw Object.assign(new Error(`http:${r.status}`), { rate: true });
  if (!r.ok) throw Object.assign(new Error(`http:${r.status}`), { rate: false });
  const j = (await r.json()) as unknown;
  if (perLine != null) {
    const out = ep.style === "single" ? parseSegments(j, perLine) : parseJoined(j, perLine);
    if (out) return out;
    throw Object.assign(new Error("shape"), { rate: false });
  }
  const one = parseJoined(j, 1);
  if (one) return one[0];
  // long free text may still come back as separate segments — join them
  const segs = Array.isArray(j) && Array.isArray(j[0]) ? j[0] : [];
  if (!segs.length) throw Object.assign(new Error("shape"), { rate: false });
  return segs.map((s) => (Array.isArray(s) ? String(s[0] ?? "") : "")).join("").replace(/\n+/g, " ").trim();
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// circuit breaker: with Google throttled and LibreTranslate doing the work,
// nothing suspends — requests simply ride the sidecar until Google cools down.
// The breaker only trips when LibreTranslate is unavailable (no sidecar) or is
// itself failing: suspend translation entirely for a while and keep storing
// originals (retried by later passes).
let consecutive429 = 0;
let suspendedUntil = 0;
const BREAKER_TRIP = 10;
const BREAKER_COOLDOWN_MS = 10 * 60 * 1000;
// when LibreTranslate rescues a Google-throttled request, keep preferring it
// for a while so we don't burn 429s on every call before falling over again
let googleBlockedUntil = 0;
const GOOGLE_COOLDOWN_MS = 10 * 60 * 1000;

async function withRetries(
  q: string,
  perLine: number | null,
  keepOriginal: string,
): Promise<string[] | string | null> {
  if (Date.now() < suspendedUntil) return null;
  let shapeFails = 0;
  // while Google sits in its cooldown, ride the LibreTranslate sidecar directly
  endpoint = LIBRE_IDX >= 0 && Date.now() < googleBlockedUntil ? LIBRE_IDX : 0;
  for (let attempt = 0; attempt < WAITS.length; attempt++) {
    const wasLibre = ENDPOINTS[endpoint].style === "libre";
    try {
      const out = await translateOnce(q, perLine);
      if (wasLibre) googleBlockedUntil = Date.now() + GOOGLE_COOLDOWN_MS;
      else endpoint = endpoint >= GOOGLE_LAST ? 0 : endpoint + 1;
      pace = Math.max(800, Math.floor(pace / 2));
      consecutive429 = 0;
      return out;
    } catch (e: unknown) {
      const rate = (e as { rate?: boolean })?.rate === true;
      if (!rate) {
        if (e instanceof Error && e.message === "shape") {
          if (++shapeFails >= 2) {
            warnOnce(`unexpected response shape — ${keepOriginal}`);
            return null;
          }
          if (!wasLibre) endpoint = endpoint >= GOOGLE_LAST ? 0 : endpoint + 1;
          await sleep(2000);
          continue;
        }
        if (attempt >= 2) {
          warnOnce(`request failed (${e instanceof Error ? e.message : e}) — ${keepOriginal}`);
          return null;
        }
        if (!wasLibre) endpoint = endpoint >= GOOGLE_LAST ? 0 : endpoint + 1;
        await sleep(5000);
        continue;
      }
      consecutive429++;
      if (wasLibre) {
        // the fallback itself is throttled/failing
        if (consecutive429 >= BREAKER_TRIP) {
          suspendedUntil = Date.now() + BREAKER_COOLDOWN_MS;
          warnOnce(`all providers rate-limited — suspending translation for 10 min; originals are kept and retried later.`);
          return null;
        }
        endpoint = 0;
      } else if (endpoint >= GOOGLE_LAST) {
        if (LIBRE_IDX >= 0) {
          // both Google endpoints refused — LibreTranslate finishes the job
          endpoint = LIBRE_IDX;
          console.warn(`[translate] Google rate-limited — falling back to LibreTranslate.`);
        } else {
          if (consecutive429 >= BREAKER_TRIP) {
            suspendedUntil = Date.now() + BREAKER_COOLDOWN_MS;
            warnOnce(`heavily rate-limited — suspending translation for 10 min; originals are kept and retried later.`);
            return null;
          }
          endpoint = 0;
        }
      } else {
        endpoint = endpoint + 1;
      }
      const wait = WAITS[Math.min(attempt, WAITS.length - 1)];
      console.warn(`[translate] rate-limited — trying next endpoint in ${Math.round(wait / 1000)}s.`);
      await sleep(wait);
    }
  }
  warnOnce(`still rate-limited after backoff — ${keepOriginal}`);
  return null;
}

export async function batchRequestLines(lines: string[]): Promise<string[] | null> {
  return (await withRetries(lines.join("\n"), lines.length, "keeping original titles; they will be retried on the next run.")) as string[] | null;
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
    const out = await batchRequestLines(chunk.map((t) => t.slice(0, 300)));
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

export async function translateText(text: string): Promise<string | null> {
  if (!translationEnabled()) return null;
  const t = text.trim();
  if (!t) return null;
  const out = await withRetries(t.slice(0, 2000), null, "keeping the original text.");
  return typeof out === "string" && out ? out : null;
}
