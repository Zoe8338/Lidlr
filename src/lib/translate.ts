// Translation chain: the Mistral AI API first when MISTRAL_API_KEY is set
// (best quality, cheap, EU-hosted), then the bundled LibreTranslate sidecar —
// self-hosted, no rate limits — finishes whatever Mistral refuses or that
// times out on. With no Mistral key everything runs on the sidecar. Failures
// degrade silently: originals are kept and retried by later passes, and the
// 24 h reconcile double-check re-verifies stored values.

const TARGET = process.env.TRANSLATE_TARGET || "en";
const CACHE = new Map<string, string | null>();
// small batches: LibreTranslate needs to finish a request well inside the
// client timeout, or aborted retries pile up on its workers and everything
// starts timing out (the sidecar is CPU-bound — 40-line batches exceeded 60 s)
const BATCH = 10;
let lastWarn = 0;

const LIBRE_URL = process.env.LIBRETRANSLATE_URL?.trim().replace(/\/$/, "");
const LIBRE_KEY = process.env.LIBRETRANSLATE_API_KEY?.trim() || undefined;
const MISTRAL_KEY = process.env.MISTRAL_API_KEY?.trim() || undefined;
const MISTRAL_MODEL = process.env.MISTRAL_MODEL?.trim() || "mistral-small-latest";

export function translationEnabled() {
  return process.env.AUTO_TRANSLATE === "1" && Boolean(LIBRE_URL || MISTRAL_KEY);
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

const targetName = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(TARGET) ?? TARGET;
  } catch {
    return TARGET;
  }
})();

// Mistral chat completions: system prompt demands JSON {"translations": [...]
// with exactly one entry per input line (response_format json_object enforces
// valid JSON), or plain text for single texts.
async function mistralOnce(q: string, perLine: number | null): Promise<string[] | string> {
  const lines = perLine != null ? q.split("\n") : null;
  const system =
    `You translate retail product data to ${targetName}. Keep model codes, article ` +
    `numbers, sizes, units and trademarks unchanged. Do not add commentary.` +
    (lines
      ? ` Input has exactly ${lines.length} lines (separated by newlines). Reply ONLY with ` +
        `JSON: {"translations": [ ... ]} containing exactly ${lines.length} translated ` +
        `strings, same order, one per input line.`
      : "");
  const r = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${MISTRAL_KEY}` },
    body: JSON.stringify({
      model: MISTRAL_MODEL,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: q },
      ],
      ...(lines ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (r.status === 429 || r.status >= 500) throw Object.assign(new Error(`http:${r.status}`), { rate: true });
  if (!r.ok) throw Object.assign(new Error(`http:${r.status}`), { rate: false });
  const j = (await r.json()) as { choices?: { message?: { content?: unknown } }[] };
  const text = typeof j?.choices?.[0]?.message?.content === "string" ? j.choices[0].message.content! : "";
  if (lines) {
    const obj = text.match(/\{[\s\S]*\}/);
    if (!obj) throw Object.assign(new Error("shape"), { rate: false });
    try {
      const arr = (JSON.parse(obj[0]) as { translations?: unknown }).translations;
      if (Array.isArray(arr) && arr.length === lines.length && arr.every((x) => typeof x === "string")) {
        return (arr as string[]).map((s) => s.trim());
      }
    } catch {
      /* fall through */
    }
    throw Object.assign(new Error("shape"), { rate: false });
  }
  const out = text.trim();
  if (!out) throw Object.assign(new Error("shape"), { rate: false });
  return out;
}

async function translateOnce(
  q: string,
  perLine: number | null,
  provider: "mistral" | "libre",
): Promise<string[] | string | null> {
  if (provider === "mistral") return mistralOnce(q, perLine);
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

// circuit breaker: if every provider is down/overloaded, stop hammering them
// for a while and keep storing originals (retried by later passes)
let consecutiveFails = 0;
let suspendedUntil = 0;
const BREAKER_TRIP = 10;
const BREAKER_COOLDOWN_MS = 10 * 60 * 1000;
// when the local sidecar rescues a failed Mistral request, keep riding it for
// a while instead of burning a failed Mistral call on every batch
let mistralBlockedUntil = 0;
const MISTRAL_COOLDOWN_MS = 10 * 60 * 1000;

async function withRetries(
  q: string,
  perLine: number | null,
  keepOriginal: string,
): Promise<string[] | string | null> {
  if (Date.now() < suspendedUntil) return null;
  const providers: ("mistral" | "libre")[] = [];
  if (MISTRAL_KEY && Date.now() >= mistralBlockedUntil) providers.push("mistral");
  if (LIBRE_URL) providers.push("libre");
  if (MISTRAL_KEY && !providers.length) providers.push("mistral");
  if (!providers.length) {
    warnOnce(`no translation provider — set LIBRETRANSLATE_URL (docker-compose bundles the sidecar) or MISTRAL_API_KEY. ${keepOriginal}`);
    return null;
  }
  let shapeFails = 0;
  let pi = 0;
  for (let attempt = 0; attempt < WAITS.length; attempt++) {
    const provider = providers[Math.min(pi, providers.length - 1)];
    try {
      const out = await translateOnce(q, perLine, provider);
      pace = Math.max(800, Math.floor(pace / 2));
      consecutiveFails = 0;
      return out;
    } catch (e: unknown) {
      // timeouts count as rate-limited: a busy provider is worth waiting for,
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
          warnOnce(`translation request failed (${e instanceof Error ? e.message : e}) — ${keepOriginal}`);
          return null;
        }
        await sleep(5000);
        continue;
      }
      consecutiveFails++;
      if (pi < providers.length - 1) {
        // offload: next provider (Mistral -> bundled LibreTranslate) finishes it
        pi++;
        if (provider === "mistral" && Date.now() >= mistralBlockedUntil) {
          mistralBlockedUntil = Date.now() + MISTRAL_COOLDOWN_MS;
          console.warn(`[translate] Mistral rate-limited — offloading to LibreTranslate for 10 min.`);
        }
      } else if (consecutiveFails >= BREAKER_TRIP) {
        suspendedUntil = Date.now() + BREAKER_COOLDOWN_MS;
        warnOnce(`all translation providers failing — suspending translation for 10 min; originals are kept and retried later.`);
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
