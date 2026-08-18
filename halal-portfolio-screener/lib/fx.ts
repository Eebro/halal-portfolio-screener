/**
 * USD -> CAD conversion.
 *
 * The screener publishes purification and zakat in USD per share, while most
 * Canadian holdings are valued in CAD. Mixing the two silently would misstate
 * portfolio totals, so conversion is explicit and the rate is always shown.
 * If the rate cannot be fetched we return null and the UI stays in USD rather
 * than inventing a number.
 */
const ENDPOINT = "https://api.frankfurter.dev/v1/latest?base=USD&symbols=CAD";
const TTL_MS = 6 * 60 * 60 * 1000;

let cache: { rate: number; date: string; at: number } | null = null;

export interface FxRate {
  usdToCad: number;
  /** Rate date as published, so staleness is visible. */
  date: string;
}

export async function getUsdToCad(): Promise<FxRate | null> {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return { usdToCad: cache.rate, date: cache.date };
  }
  try {
    const res = await fetch(ENDPOINT, { headers: { "User-Agent": "halal-portfolio-screener/0.1" } });
    if (!res.ok) return null;
    const body = (await res.json()) as { date: string; rates: { CAD?: number } };
    const rate = body?.rates?.CAD;
    if (typeof rate !== "number" || !Number.isFinite(rate)) return null;
    cache = { rate, date: body.date, at: Date.now() };
    return { usdToCad: rate, date: body.date };
  } catch {
    return null;
  }
}
