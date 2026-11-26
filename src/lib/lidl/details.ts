// Product description + spec pairs ("Gewicht: 2 kg") parsed from the product
// page HTML. Lidl product pages keep the marketing copy in an
// article.content-tabs__description element and short highlight/lines in
// .short-description__description (often <strong>Key</strong>: value pairs).
// The article may embed <style> blocks (for its feature/dimension tables) and
// <table> markup — styles are dropped, table rows are folded into the
// description as "label: value" lines.

export function stripHtml(s: string): string {
  return s
    .replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, " ")
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

// headings that end the intro copy on localised Lidl pages
const FEATURE_HEADING =
  /\b(Eigenschaften|Ausstattung|Features|Feature|Caractéristiques|Características|Caratteristiche|Właściwości|Funkcje|Specifikace|Specificații|Technische Daten|Dane techniczne)\b/;

export function parseDetails(html: string): ProductDetails {
  const out: ProductDetails = {};

  const short = firstMatch(html, /class="short-description__description"[^>]*>([\s\S]*?)<\/(?:div|section)>/);
  const raw = firstMatch(html, /<article class="content-tabs__description[^"]*"[^>]*>([\s\S]*?)<\/article>/);
  const primary = raw ? raw.replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, " ") : null;

  const bullets = primary
    ? [...primary.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => stripHtml(m[1])).filter(Boolean)
    : [];

  // feature/dimension tables -> "label: value" lines
  const tableLines: string[] = [];
  for (const t of primary?.matchAll(/<table\b[\s\S]*?<\/table>/gi) ?? []) {
    for (const r of t[0].matchAll(/<tr\b[\s\S]*?<\/tr>/gi)) {
      const cells = [...r[0].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
        .map((m) => stripHtml(m[1]))
        .filter(Boolean);
      if (!cells.length) continue;
      const label = cells[0].replace(/\s*:\s*$/, "");
      tableLines.push(cells.length === 1 ? label : `${label}: ${cells.slice(1).join(", ")}`);
    }
  }

  // body text without tables (added back as structured lines below)
  const lead = primary ? stripHtml(primary.replace(/<table\b[\s\S]*?<\/table>/gi, " ")) : null;

  const seen = new Set<string>();
  const dedup = (xs: string[]) =>
    xs.filter((x) => {
      const k = x.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

  if (bullets.length > 1 || tableLines.length) {
    const intro = lead ? lead.split(FEATURE_HEADING)[0].trim() : "";
    const parts = dedup([intro, dedup(bullets).join("; "), dedup(tableLines).join("; ")].map((x) => x.trim()).filter(Boolean));
    out.description = parts.join(" — ").replace(/\s*;\s*/g, "; ").slice(0, 1500) || undefined;
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
