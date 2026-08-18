/**
 * Builds the curated ETF registry.
 *
 * The stock screener has ZERO ETF coverage — SPUS, SPWO, SPTE, SPSK, WSHR,
 * HLAL and UMMA all return no results. Since ETFs are often the largest slice
 * of a portfolio by value, they need their own data path.
 *
 * SP Funds publishes quarterly purification rates as a percentage of
 * dividends, which we scrape. Other providers are hand-seeded; where we do not
 * have a vetted rate we record `null` and say so rather than inventing one.
 *
 * Run: npm run build:etfs
 */
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { EtfEntry } from "@/lib/types";

const UA = "halal-portfolio-screener/0.1 (hackday project) node-fetch";
const SP_CALC = "https://www.sp-funds.com/purification-calculator/";

function decode(s: string): string {
  return s
    .replace(/&#038;|&amp;/g, "&")
    .replace(/&#8217;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

/** Scrape the quarterly purification-rate table (Date | SPUS | SPRE | SPTE | SPWO). */
async function scrapeSpFundsRates(): Promise<{
  rates: Record<string, { pct: number; period: string }>;
  warnings: string[];
}> {
  const warnings: string[] = [];
  const rates: Record<string, { pct: number; period: string }> = {};

  const res = await fetch(SP_CALC, { headers: { "User-Agent": UA } });
  if (!res.ok) {
    warnings.push(`SP Funds purification page returned HTTP ${res.status}; rates left unset.`);
    return { rates, warnings };
  }
  const html = await res.text();

  const tables = html.match(/<table[\s\S]*?<\/table>/gi) ?? [];
  for (const table of tables) {
    const rows = table.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
    const cellsOf = (row: string) =>
      (row.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) ?? []).map((c) =>
        decode(c.replace(/<[^>]*>/g, "")).trim(),
      );

    const header = cellsOf(rows[0] ?? "");
    if (!/date/i.test(header[0] ?? "")) continue;

    const tickers = header.slice(1).map((t) => t.toUpperCase());
    // Rows are newest-first; take the first row that has a usable value.
    for (const row of rows.slice(1)) {
      const cells = cellsOf(row);
      const period = cells[0];
      cells.slice(1).forEach((cell, i) => {
        const ticker = tickers[i];
        if (!ticker || rates[ticker]) return;
        const m = cell.match(/^([\d.]+)\s*%$/);
        if (m) rates[ticker] = { pct: Number(m[1]), period };
      });
    }
    break;
  }

  if (Object.keys(rates).length === 0) {
    warnings.push("Could not find the SP Funds purification table; layout may have changed.");
  }
  return { rates, warnings };
}

/**
 * Hand-curated base list. Every entry here is a fund whose *mandate* is
 * Shariah compliance — we are not screening holdings, we are recording that
 * the fund is constructed to a Shariah standard. Anything not in this list
 * renders as "needs review" rather than being assumed compliant.
 */
const BASE: EtfEntry[] = [
  {
    ticker: "SPUS",
    name: "SP Funds S&P 500 Sharia Industry Exclusions ETF",
    provider: "SP Funds",
    shariahCompliant: true,
    purificationRatePct: null,
    ratePeriod: null,
    note: null,
    sourceUrl: SP_CALC,
  },
  {
    ticker: "SPWO",
    name: "SP Funds S&P World (ex-US) ETF",
    provider: "SP Funds",
    shariahCompliant: true,
    purificationRatePct: null,
    ratePeriod: null,
    note: null,
    sourceUrl: SP_CALC,
  },
  {
    ticker: "SPTE",
    name: "SP Funds S&P Global Technology ETF",
    provider: "SP Funds",
    shariahCompliant: true,
    purificationRatePct: null,
    ratePeriod: null,
    note: null,
    sourceUrl: SP_CALC,
  },
  {
    ticker: "SPRE",
    name: "SP Funds S&P Global REIT Sharia ETF",
    provider: "SP Funds",
    shariahCompliant: true,
    purificationRatePct: null,
    ratePeriod: null,
    note: null,
    sourceUrl: SP_CALC,
  },
  {
    ticker: "SPSK",
    name: "SP Funds Dow Jones Global Sukuk ETF",
    provider: "SP Funds",
    shariahCompliant: true,
    purificationRatePct: 0,
    ratePeriod: null,
    note: "No purification required — sukuk are Shariah-compliant by definition.",
    sourceUrl: SP_CALC,
  },
  {
    ticker: "WSHR",
    name: "Wealthsimple Shariah World Equity Index ETF",
    provider: "Wealthsimple",
    shariahCompliant: true,
    purificationRatePct: null,
    ratePeriod: null,
    note: "Shariah-compliant by mandate. Wealthsimple publishes purification guidance separately — enter the rate manually if you have it.",
    sourceUrl: "https://www.wealthsimple.com/en-ca/product/shariah-etf",
  },
  {
    ticker: "HLAL",
    name: "Wahed FTSE USA Shariah ETF",
    provider: "Wahed",
    shariahCompliant: true,
    purificationRatePct: null,
    ratePeriod: null,
    note: "Shariah-compliant by mandate. Wahed publishes purification rates on its fund page.",
    sourceUrl: "https://funds.wahedinvest.com/hlal",
  },
  {
    ticker: "UMMA",
    name: "Wahed Dow Jones Islamic World ETF",
    provider: "Wahed",
    shariahCompliant: true,
    purificationRatePct: null,
    ratePeriod: null,
    note: "Shariah-compliant by mandate. Wahed publishes purification rates on its fund page.",
    sourceUrl: "https://funds.wahedinvest.com/umma",
  },
];

async function main() {
  const { rates, warnings } = await scrapeSpFundsRates();

  const entries = BASE.map((e) => {
    const rate = rates[e.ticker];
    if (rate && e.purificationRatePct === null) {
      return { ...e, purificationRatePct: rate.pct, ratePeriod: rate.period };
    }
    return e;
  });

  const registry = {
    builtAt: new Date().toISOString(),
    sources: [SP_CALC],
    warnings,
    entries,
  };

  const dir = join(process.cwd(), "data");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "etf-registry.json"), JSON.stringify(registry, null, 2));

  console.log(`Wrote data/etf-registry.json with ${entries.length} funds`);
  for (const e of entries) {
    const r =
      e.purificationRatePct === null
        ? "rate: unknown"
        : `rate: ${e.purificationRatePct}%${e.ratePeriod ? ` (${e.ratePeriod})` : ""}`;
    console.log(`  ${e.ticker.padEnd(6)} ${r}`);
  }
  for (const w of warnings) console.warn(`  WARNING: ${w}`);
}

main().catch((err) => {
  console.error("build-etfs failed:", err);
  process.exit(1);
});
