const TARGET = process.env.TRANSLATE_TARGET || "en";
const CACHE = new Map<string, string | null>();

export function translationEnabled() {
  return process.env.AUTO_TRANSLATE === "1";
}

// Free community translation endpoint; no key, cached per title + retried nothing.
// Failures degrade silently: the original title is kept.
export async function translateTitle(raw: string): Promise<string | null> {
  if (!translationEnabled() || !raw?.trim()) return null;
  if (CACHE.has(raw)) return CACHE.get(raw) ?? null;
  try {
    const q = encodeURIComponent(raw.slice(0, 300));
    const u = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${TARGET}&dt=t&q=${q}`;
    const r = await fetch(u, {
      headers: { "user-agent": "Mozilla/5.0", accept: "*/*" },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error(String(r.status));
    const j = (await r.json()) as unknown;
    const segs = Array.isArray(j) && Array.isArray(j[0]) ? j[0] : [];
    const out = segs
      .map((s) => (Array.isArray(s) ? String(s[0] ?? "") : ""))
      .join("")
      .trim();
    const value = out || null;
    CACHE.set(raw, value);
    return value;
  } catch {
    CACHE.set(raw, null);
    return null;
  }
}
