// Product description + spec pairs ("Gewicht: 2 kg") parsed from the product
// page HTML. Lidl product pages keep the marketing copy in an
// article.content-tabs__description element and short highlight/lines in
// .short-description__description (often <strong>Key</strong>: value pairs).

export function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&Oslash;/g, "Ø")
    .replace(/&times;/g, "×")
    .replace(/&deg;/g, "°")
    .replace(/&nbsp;/g, " ")
    .replace(/&szlig;/g, "ß")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&auml;/g, "ä")
    .replace(/&ouml;/g, "ö")
    .replace(/&uuml;/g, "ü")
    .replace(/&Auml;/g, "Ä")
    .replace(/&Ouml;/g, "Ö")
    .replace(/&Uuml;/g, "Ü")
    .replace(/&reg;/g, "®")
    .replace(/&laquo;/g, "«")
    .replace(/&raquo;/g, "»")
    .replace(/\s+/g, " ")
    .trim();
}

function firstMatch(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m ? m[1] : null;
}

export type ProductDetails = { description?: string; specs?: { k: string; v: string }[] };

export function parseDetails(html: string): ProductDetails {
  const out: ProductDetails = {};

  const short = firstMatch(html, /class="short-description__description"[^>]*>([\s\S]*?)<\/(?:div|section)>/);
  const primary = firstMatch(html, /<article class="content-tabs__description[^"]*"[^>]*>([\s\S]*?)<\/article>/);
  const bullets = primary
    ? [...primary.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => stripHtml(m[1])).filter(Boolean)
    : [];
  const lead = primary ? stripHtml(primary) : null;

  if (bullets.length > 1) {
    const intro = lead ? lead.split("Eigenschaften")[0].trim() : "";
    const body = intro ? `${intro} — ${bullets.join("; ")}` : bullets.join("; ");
    out.description = body.replace(/\s*;\s*/g, "; ").slice(0, 1200) || undefined;
  } else if (short) {
    out.description = stripHtml(short).slice(0, 1200) || undefined;
  } else if (lead) {
    out.description = lead.slice(0, 1200) || undefined;
  }

  const specs: { k: string; v: string }[] = [];
  if (short) {
    for (const m of short.matchAll(/<strong[^>]*>([\s\S]*?)<\/strong>\s*:?\s*([^<]*)/g)) {
      const k = stripHtml(m[1]).replace(/:$/, "");
      const v = stripHtml(m[2]).replace(/^:/, "").trim();
      if (k && v && v.length <= 120) specs.push({ k, v });
    }
  }
  if (specs.length) out.specs = specs.slice(0, 12);
  return out;
}
