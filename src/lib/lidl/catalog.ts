export type CountryConfig = {
  code: string;
  name: string;
  host: string;
  locale: string;
  assortment: string;
  currency: string;
  enabled: boolean;
};

// Lidl shops in the EU (plus EEA/CH/GB flagged off by default).
export const COUNTRIES: CountryConfig[] = [
  { code: "DE", name: "Germany", host: "www.lidl.de", locale: "de_DE", assortment: "DE", currency: "EUR", enabled: true },
  { code: "AT", name: "Austria", host: "www.lidl.at", locale: "de_AT", assortment: "AT", currency: "EUR", enabled: true },
  { code: "FR", name: "France", host: "www.lidl.fr", locale: "fr_FR", assortment: "FR", currency: "EUR", enabled: true },
  { code: "IT", name: "Italy", host: "www.lidl.it", locale: "it_IT", assortment: "IT", currency: "EUR", enabled: true },
  { code: "ES", name: "Spain", host: "www.lidl.es", locale: "es_ES", assortment: "ES", currency: "EUR", enabled: true },
  { code: "PT", name: "Portugal", host: "www.lidl.pt", locale: "pt_PT", assortment: "PT", currency: "EUR", enabled: true },
  { code: "NL", name: "Netherlands", host: "www.lidl.nl", locale: "nl_NL", assortment: "NL", currency: "EUR", enabled: true },
  { code: "BE", name: "Belgium", host: "www.lidl.be", locale: "fr_BE", assortment: "BE", currency: "EUR", enabled: true },
  { code: "PL", name: "Poland", host: "www.lidl.pl", locale: "pl_PL", assortment: "PL", currency: "PLN", enabled: true },
  { code: "CZ", name: "Czechia", host: "www.lidl.cz", locale: "cs_CZ", assortment: "CZ", currency: "CZK", enabled: true },
  { code: "SK", name: "Slovakia", host: "www.lidl.sk", locale: "sk_SK", assortment: "SK", currency: "EUR", enabled: true },
  { code: "HU", name: "Hungary", host: "www.lidl.hu", locale: "hu_HU", assortment: "HU", currency: "HUF", enabled: true },
  { code: "RO", name: "Romania", host: "www.lidl.ro", locale: "ro_RO", assortment: "RO", currency: "RON", enabled: true },
  { code: "BG", name: "Bulgaria", host: "www.lidl.bg", locale: "bg_BG", assortment: "BG", currency: "BGN", enabled: true },
  { code: "GR", name: "Greece", host: "www.lidl.gr", locale: "el_GR", assortment: "GR", currency: "EUR", enabled: true },
  { code: "IE", name: "Ireland", host: "www.lidl.ie", locale: "en_IE", assortment: "IE", currency: "EUR", enabled: true },
  { code: "HR", name: "Croatia", host: "www.lidl.hr", locale: "hr_HR", assortment: "HR", currency: "EUR", enabled: true },
  { code: "SI", name: "Slovenia", host: "www.lidl.si", locale: "sl_SI", assortment: "SI", currency: "EUR", enabled: true },
  { code: "FI", name: "Finland", host: "www.lidl.fi", locale: "fi_FI", assortment: "FI", currency: "EUR", enabled: true },
  { code: "SE", name: "Sweden", host: "www.lidl.se", locale: "sv_SE", assortment: "SE", currency: "SEK", enabled: true },
  { code: "DK", name: "Denmark", host: "www.lidl.dk", locale: "da_DK", assortment: "DK", currency: "DKK", enabled: true },
  { code: "LT", name: "Lithuania", host: "www.lidl.lt", locale: "lt_LT", assortment: "LT", currency: "EUR", enabled: true },
  { code: "LV", name: "Latvia", host: "www.lidl.lv", locale: "lv_LV", assortment: "LV", currency: "EUR", enabled: true },
  { code: "EE", name: "Estonia", host: "www.lidl.ee", locale: "et_EE", assortment: "EE", currency: "EUR", enabled: true },
  { code: "CY", name: "Cyprus", host: "www.lidl.cy", locale: "en_CY", assortment: "CY", currency: "EUR", enabled: true },
  { code: "LU", name: "Luxembourg", host: "www.lidl.lu", locale: "de_LU", assortment: "LU", currency: "EUR", enabled: true },
  { code: "MT", name: "Malta", host: "www.lidl.com.mt", locale: "en_MT", assortment: "MT", currency: "EUR", enabled: true },
  { code: "CH", name: "Switzerland", host: "www.lidl.ch", locale: "de_CH", assortment: "CH", currency: "CHF", enabled: false },
  { code: "GB", name: "United Kingdom", host: "www.lidl.co.uk", locale: "en_GB", assortment: "GB", currency: "GBP", enabled: false },
];

export const BRANDS: { slug: string; family: string; queries: string[] }[] = [
  { slug: "parkside", family: "parkside", queries: ["PARKSIDE"] },
  { slug: "parkside-performance", family: "parkside", queries: ["PARKSIDE PERFORMANCE"] },
  { slug: "esmara", family: "esmara", queries: ["ESMARA"] },
  { slug: "esmara-men", family: "esmara", queries: ["ESMARA MEN"] },
  { slug: "esmara-lingerie", family: "esmara", queries: ["ESMARA LINGERIE"] },
  { slug: "crivit", family: "crivit", queries: ["CRIVIT", "CRIVIT PERFORMANCE", "CRIVIT BY JETTE SPORT"] },
  { slug: "livery", family: "livery", queries: ["LIVERY", "LIVERGY"] },
  { slug: "cien", family: "cien", queries: ["CIEN", "CIEN MEN"] },
  { slug: "silvercrest", family: "silvercrest", queries: ["SILVERCREST"] },
  { slug: "silvercrest-personal-care", family: "silvercrest", queries: ["SILVERCREST PERSONAL CARE"] },
  { slug: "silvercrest-kitchen-tools", family: "silvercrest", queries: ["SILVERCREST KITCHEN TOOLS"] },
  { slug: "dentalux", family: "dentalux", queries: ["DENTALUX"] },
  { slug: "livarno", family: "livarno", queries: ["LIVARNO"] },
  { slug: "livarno-lux", family: "livarno", queries: ["LIVARNO LUX", "LIVARNO LUXE"] },
  { slug: "livarno-home", family: "livarno", queries: ["LIVARNO HOME", "LIVARNO MAISON"] },
];

export function slugifyBrand(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const s = raw.toLowerCase().trim().replace(/\s+/g, "-");
  for (const b of BRANDS) if (b.queries.some((q) => q.toLowerCase() === s.replace(/-/g, " ")) || b.slug === s) return b.slug;
  if (/silvercrest.*personal.*(care)/i.test(s)) return "silvercrest-personal-care";
  if (/silvercrest.*kitchen/.test(s)) return "silvercrest-kitchen-tools";
  if (/silvercrest/.test(s)) return "silvercrest";
  if (/livarno.*(lux|luxe)/.test(s)) return "livarno-lux";
  if (/livarno.*(home|maison|hogar|casa)/.test(s)) return "livarno-home";
  if (/livarno/.test(s)) return "livarno";
  if (/parkside.*performance/.test(s)) return "parkside-performance";
  if (/parkside/.test(s)) return "parkside";
  if (/esmara.*men/.test(s)) return "esmara-men";
  if (/esmara.*(lingerie)/.test(s)) return "esmara-lingerie";
  if (/esmara/.test(s)) return "esmara";
  if (/livery|livergy/.test(s)) return "livery";
  if (/cien/.test(s)) return "cien";
  if (/dentalux|denta?lux/.test(s)) return "dentalux";
  if (/crivit/.test(s)) return "crivit";
  return s;
}

// Sub-lines within a brand family (Livarno Home, Parkside Performance, ...).
// Key = family slug; values = selectable sub-line labels, first entry = family base.
export const SUB_LINES: Record<string, string[]> = {
  parkside: ["Parkside", "Parkside Performance"],
  esmara: ["Esmara", "Esmara Men", "Esmara Lingerie"],
  crivit: ["Crivit", "Crivit Performance", "Crivit by Jette Sport"],
  silvercrest: ["Silvercrest", "Silvercrest Personal Care", "Silvercrest Kitchen Tools"],
  livarno: ["Livarno", "Livarno Home", "Livarno Lux"],
  cien: ["Cien", "Cien Men"],
};

const SUB_LINE_PATTERNS: Record<string, RegExp> = {
  "Parkside Performance": /PARKSIDE[®\s-]*PERFORMANCE/,
  "Esmara Men": /ESMARA[®\s-]*MEN/,
  "Esmara Lingerie": /ESMARA[®\s-]*(LINGERIE|UNDIEZ|DAMENWASCHE|DAMENWÄSCHE)/,
  "Crivit Performance": /CRIVIT[®\s-]*PERFORMANCE/,
  "Crivit by Jette Sport": /CRIVIT[®\s-]*BY[®\s-]*JETTE/,
  "Silvercrest Personal Care": /SILVERCREST[®\s-]*PERSONAL[®\s-]*CARE/,
  "Silvercrest Kitchen Tools": /SILVERCREST[®\s-]*KITCHEN[®\s-]*TOOLS/,
  "Livarno Home": /LIVARNO[®\s-]*(HOME|MAISON|HOGAR|CASA|HOGAR)/,
  "Livarno Lux": /LIVARNO[®\s-]*LU[XE]/,
  "Cien Men": /CIEN[®\s-]*MEN/,
};

// does a product belong to the given sub-line label? The family base label
// ("Livarno") matches products without any specific sub-line.
export function matchesSubLine(title: string | null | undefined, brandName: string | null | undefined, label: string, family?: string): boolean {
  const hay = `${brandName ?? ""} ${title ?? ""}`.toUpperCase();
  const specific = Object.keys(SUB_LINE_PATTERNS).filter((k) => k.startsWith(label));
  if (label !== family && SUB_LINE_PATTERNS[label]) return SUB_LINE_PATTERNS[label].test(hay);
  void specific;
  // base label: family brand, but only when no specific sub-line of this family matches
  const familyRe = SUB_LINES[family ?? ""];
  const others = (familyRe ?? []).filter((l) => l !== (family ?? label));
  const hasOther = others.some((l) => SUB_LINE_PATTERNS[l]?.test(hay));
  return hay.includes(label.toUpperCase()) && !hasOther;
}
