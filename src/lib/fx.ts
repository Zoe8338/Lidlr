import { COUNTRIES } from "./lidl/catalog.ts";

const SYMBOLS = [...new Set(COUNTRIES.map((c) => c.currency).concat("EUR"))];
const TTL_MS = 60 * 60 * 1000;

// ECB central parity: BGN is pegged to the euro and not published daily by frankfurter.
const PEGS: Record<string, number> = { BGN: 1 / 1.95583 };

export type FxRates = {
  base: "EUR";
  date: string;
  rates: Record<string, number>;
};

let cache: FxRates | null = null;
let fetchedAt = 0;

export async function getFxRates(): Promise<FxRates | null> {
  if (cache && Date.now() - fetchedAt < TTL_MS) return cache;
  try {
    const u = `https://api.frankfurter.dev/v1/latest?base=EUR&symbols=${SYMBOLS.join(",")}`;
    const r = await fetch(u, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8000),
      next: { revalidate: TTL_MS / 1000 },
    });
    if (!r.ok) throw new Error(String(r.status));
    const j = (await r.json()) as { date?: string; rates?: Record<string, number> };
    cache = { base: "EUR", date: j.date ?? new Date().toISOString().slice(0, 10), rates: { ...PEGS, ...(j.rates ?? {}) } };
    fetchedAt = Date.now();
    return cache;
  } catch {
    return cache;
  }
}

export function convert(amount: number, from: string, to: string, fx: FxRates): number | null {
  if (from === to) return amount;
  const { rates } = fx;
  if (from === "EUR") return rates[to] ? amount * rates[to] : null;
  if (to === "EUR") return rates[from] ? amount / rates[from] : null;
  if (!rates[from] || !rates[to]) return null;
  return (amount / rates[from]) * rates[to];
}

const nf = new Intl.NumberFormat("en", { style: "currency", currency: "EUR", currencyDisplay: "narrowSymbol" });

// format non-euro prices the way locals read them (e.g. "2 999 Ft")
const CURRENCY_LOCALE: Record<string, string> = {
  PLN: "pl-PL",
  CZK: "cs-CZ",
  HUF: "hu-HU",
  RON: "ro-RO",
  BGN: "bg-BG",
  SEK: "sv-SE",
  DKK: "da-DK",
  CHF: "de-CH",
  GBP: "en-GB",
};

export function fmtEur(value: number): string {
  return nf.format(value);
}

export function fmtLocal(value: number, currency: string): string | null {
  if (!currency) return null;
  if (currency === "EUR") return fmtEur(value);
  try {
    return new Intl.NumberFormat(CURRENCY_LOCALE[currency] ?? "en", {
      style: "currency",
      currency,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

export function toEur(amount: number, currency: string | null | undefined, fx: FxRates | null): number | null {
  if (amount == null) return null;
  if (!currency || !fx || currency === "EUR") return amount;
  return convert(amount, currency, "EUR", fx);
}

export const CURRENCY_NAMES: Record<string, string> = {
  EUR: "Euro",
  PLN: "Polish złoty",
  CZK: "Czech koruna",
  HUF: "Hungarian forint",
  RON: "Romanian leu",
  BGN: "Bulgarian lev",
  SEK: "Swedish krona",
  DKK: "Danish krone",
  CHF: "Swiss franc",
  GBP: "British pound",
};
