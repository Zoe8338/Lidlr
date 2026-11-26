// Translation runs entirely on the bundled LibreTranslate sidecar — no
// external requests, no rate limits, no keys. Configure it with
// LIBRETRANSLATE_URL (docker-compose points at the `libretranslate` service by
// default; set it empty to disable translation). Titles are batched several
// per request. Failures degrade silently: originals are kept and retried by
// later passes, and the 24 h reconcile double-check re-verifies stored values.

const TARGET = process.env.TRANSLATE_TARGET || "en";
const CACHE = new Map<string, string | null>();
const BATCH = 40;
let lastWarn = 0;

const LIBRE_URL = process.env.LIBRETRANSLATE_URL?.trim().replace(/\/$/, "");
const LIBRE_KEY = process.env.LIBRETRANSLATE_API_KEY?.trim() || undefined;

export function translationEnabled() {
  return process.env.AUTO_TRANSLATE === "1" && Boolean(LIBRE_URL);
}

function warnOnce(msg: string) {
  const now = Date.now();
  if (now - lastWarn > 60000) {
    console.warn(`[translate] ${msg}`);
    lastWarn = now;
  }
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
  const r = await fetch(`${LIBRE_URL}/translate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      q: perLine != null ? q.split("\n") : q,
      source: "auto",
      target: TARGET,
      format: "text",
      ...(LIBRE_KEY ? { api_key: LIBRE_KEY } : {}),
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (r.status === 429 || r.status >= 500) throw Object.assign(new Error(`http:${r.status}`), { rate: true });
  if (!r.ok) throw Object.assign(new Error(`http:${r.status}`), { rate: false });
  const j = (await r.json()) as unknown;
  const out = parseLibre(j, perLine);
  if (out) return out;
  throw Object.assign(new Error("shape"), { rate: false });
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

let pace = 800;
const WAITS = [5000, 15000, 60000, 300000];

// circuit breaker: if the sidecar is down or overloaded, stop hammering it for
// a while and keep storing originals (retried by later passes)
let consecutiveFails = 0;
let suspendedUntil = 0;
const BREAKER_TRIP = 10;
const BREAKER_COOLDOWN_MS = 10 * 60 * 1000;

async function withRetries(
  q: string,
  perLine: number | null,
  keepOriginal: string,
): Promise<string[] | string | null> {
  if (Date.now() < suspendedUntil) return null;
  if (!LIBRE_URL) {
    warnOnce(`no translation provider — set LIBRETRANSLATE_URL (docker-compose bundles the sidecar). ${keepOriginal}`);
    return null;
  }
  let shapeFails = 0;
  for (let attempt = 0; attempt < WAITS.length; attempt++) {
    try {
      const out = await translateOnce(q, perLine);
      pace = Math.max(800, Math.floor(pace / 2));
      consecutiveFails = 0;
      return out;
    } catch (e: unknown) {
      // timeouts count as rate-limited: a busy sidecar is worth waiting for,
      // the request itself is cheap to repeat
      const rate =
        (e as { rate?: boolean })?.rate === true ||
        (e instanceof Error && /abort|timeout|terminated/i.test(e.message));
      if (!rate) {
        if (e instanceof Error && e.message === "shape") {
          if (++shapeFails >= 2) {
            warnOnce(`unexpected response shape — ${keepOriginal}`);
            return null;
          }
          await sleep(2000);
          continue;
        }
        if (attempt >= 1) {
          warnOnce(`LibreTranslate request failed (${e instanceof Error ? e.message : e}) — is the libretranslate sidecar running and done loading models? ${keepOriginal}`);
          return null;
        }
        await sleep(5000);
        continue;
      }
      consecutiveFails++;
      if (consecutiveFails >= BREAKER_TRIP) {
        suspendedUntil = Date.now() + BREAKER_COOLDOWN_MS;
        warnOnce(`LibreTranslate heavily rate-limited — suspending translation for 10 min; originals are kept and retried later.`);
        return null;
      }
      const wait = WAITS[Math.min(attempt, WAITS.length - 1)];
      console.warn(`[translate] rate-limited — retrying in ${Math.round(wait / 1000)}s.`);
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
