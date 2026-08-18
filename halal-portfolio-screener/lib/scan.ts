/**
 * Orchestrates a portfolio scan: route each holding, resolve screenable ones
 * against the local index, fetch their detail pages, and compute purification.
 */
import { getResolver, normalizeTicker } from "@/lib/screener/resolve";
import { fetchMany } from "@/lib/screener/detail";
import { routeHolding, countsTowardComplianceRatio } from "@/lib/assetRouter";
import { computePurification, totalPurification } from "@/lib/purification";
import type {
  ComplianceStatus,
  EtfEntry,
  Holding,
  ScreenedHolding,
  ScreenResult,
} from "@/lib/types";
import etfRegistry from "@/data/etf-registry.json";

const ETFS = new Map<string, EtfEntry>(
  (etfRegistry.entries as EtfEntry[]).map((e) => [e.ticker.toUpperCase(), e]),
);

function baseTicker(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/\.(TO|TSX|V|NE|CN|U)$/i, "");
}

export interface ScanSummary {
  totalPositions: number;
  /** Distinct assets after consolidating the same holding across accounts. */
  distinctAssets: number;
  /** Every position including cash, crypto and metal, normalized to CAD. */
  totalPortfolioValueCad: number;
  /** Just the screenable equity and fund value, normalized to CAD. */
  investedValueCad: number;
  cashValueCad: number;
  accounts: { name: string; valueCad: number }[];
  screenedPositions: number;
  compliantCount: number;
  nonCompliantCount: number;
  unresolvedCount: number;
  needsReviewCount: number;
  /** Percentage of screenable market value that is compliant. */
  compliantPctByValue: number | null;
  /**
   * Market value we could not reach a verdict on, in CAD.
   * Always CAD so callers never re-convert it.
   */
  unverifiedValueCad: number;
  /**
   * False when no FX rate was available and USD positions had to be counted at
   * face value. The UI says so rather than presenting a precise-looking total.
   */
  valuesFxNormalized: boolean;
  purification: ReturnType<typeof totalPurification>;
}

/**
 * Market values arrive in whichever currency the position trades in — a real
 * export mixes CAD and USD rows freely. Summing them raw would overstate the
 * CAD share of the portfolio and skew the compliance percentage, so everything
 * is normalized to CAD before aggregation.
 */
function marketValueCad(holding: Holding, usdToCad: number | null): number {
  const value = Math.abs(holding.marketValue);
  const currency = (holding.marketValueCurrency || "CAD").toUpperCase();
  if (currency === "CAD") return value;
  if (currency === "USD" && usdToCad) return value * usdToCad;
  // Unknown currency with no rate: fall back to the CAD book value if the
  // broker gave us one, otherwise count at face value and flag it upstream.
  return holding.bookValueCad !== null ? Math.abs(holding.bookValueCad) : value;
}

export interface ScanOutput {
  holdings: ScreenedHolding[];
  summary: ScanSummary;
  /** Non-fatal issues worth showing rather than hiding. */
  warnings: string[];
  sourceUpdatedOn: string | null;
}

export async function scanHoldings(
  holdings: Holding[],
  dividends: Record<string, number> = {},
  usdToCad: number | null = null,
): Promise<ScanOutput> {
  const resolver = await getResolver();
  const warnings: string[] = [];

  // Pass 1: route and resolve. Collect slugs so detail pages can be fetched
  // concurrently rather than one holding at a time.
  type Pending = {
    holding: Holding;
    route: ReturnType<typeof routeHolding>;
    slug: string | null;
    status: ComplianceStatus;
    explanation: string;
    etf: EtfEntry | null;
    candidates?: ScreenedHolding["candidates"];
  };

  const pending: Pending[] = holdings.map((holding) => {
    const route = routeHolding(holding);

    if (route.route === "cash" || route.route === "informational") {
      return {
        holding,
        route,
        slug: null,
        status: "NOT_SCREENABLE",
        explanation: route.explanation,
        etf: null,
      };
    }

    if (route.route === "etf") {
      const etf = ETFS.get(baseTicker(holding.symbol)) ?? null;
      if (!etf) {
        return {
          holding,
          route,
          slug: null,
          status: "NEEDS_REVIEW",
          explanation:
            "This fund is not in the vetted registry. The stock screener does not cover ETFs, so no verdict is asserted — check the fund's own Shariah documentation.",
          etf: null,
        };
      }
      return {
        holding,
        route,
        slug: null,
        status: etf.shariahCompliant ? "COMPLIANT" : "NOT_COMPLIANT",
        explanation: etf.shariahCompliant
          ? `${etf.name} is constructed to a Shariah standard by ${etf.provider}.`
          : `${etf.name} is not a Shariah-compliant fund.`,
        etf,
      };
    }

    const outcome = resolver.resolve({
      symbol: holding.symbol,
      name: holding.name,
      mic: holding.mic,
      exchange: holding.exchange,
    });

    if (outcome.kind === "resolved") {
      return {
        holding,
        route,
        slug: outcome.entry.s,
        status: outcome.entry.v === "N" ? "NOT_COMPLIANT" : "COMPLIANT",
        explanation: "",
        etf: null,
      };
    }

    const candidates = outcome.candidates.map((c) => ({
      ticker: c.entry.raw,
      name: c.entry.n,
      slug: c.entry.s,
      exchange: c.exchangeName,
    }));

    if (outcome.kind === "conflict") {
      warnings.push(`${holding.symbol}: ${outcome.reason}`);
      return {
        holding,
        route,
        slug: null,
        status: "NEEDS_REVIEW",
        explanation: `${outcome.reason} Pick the correct listing to resolve it.`,
        etf: null,
        candidates,
      };
    }

    return {
      holding,
      route,
      slug: null,
      status: "UNRESOLVED",
      explanation: outcome.reason,
      etf: null,
      candidates,
    };
  });

  // Pass 2: fetch detail pages for everything that resolved.
  const slugs = pending.map((p) => p.slug).filter((s): s is string => s !== null);
  const details = await fetchMany(slugs);

  let sourceUpdatedOn: string | null = null;

  const result: ScreenedHolding[] = pending.map((p) => {
    let screen: ScreenResult | null = null;
    let status = p.status;
    let explanation = p.explanation;

    if (p.slug) {
      const d = details.get(p.slug);
      if (d instanceof Error) {
        status = "UNRESOLVED";
        explanation = `Could not load screening data: ${d.message}`;
      } else if (d) {
        screen = d;
        // Trust the detail page over the index summary — it is the fuller record.
        status = d.status === "NOT_COMPLIANT" ? "NOT_COMPLIANT" : "COMPLIANT";
        explanation = d.summary;
        if (!sourceUpdatedOn && d.updatedOn) sourceUpdatedOn = d.updatedOn;
      }
    }

    const dividendsReceivedUsd = dividends[p.holding.symbol.toUpperCase()] ?? null;

    return {
      holding: p.holding,
      route: p.route.route,
      status,
      screen,
      etf: p.etf,
      purification: computePurification({
        holding: p.holding,
        screen,
        etf: p.etf,
        dividendsReceivedUsd,
      }),
      explanation,
      candidates: p.candidates,
    };
  });

  const mixedCurrencies = new Set(
    holdings.map((h) => (h.marketValueCurrency || "CAD").toUpperCase()),
  ).size > 1;
  if (mixedCurrencies && !usdToCad) {
    warnings.push(
      "No USD→CAD rate was available, so portfolio totals mix currencies at face value and are approximate.",
    );
  }

  return {
    holdings: result,
    summary: summarize(result, usdToCad),
    warnings,
    sourceUpdatedOn,
  };
}

function summarize(items: ScreenedHolding[], usdToCad: number | null): ScanSummary {
  const screenable = items.filter((i) => countsTowardComplianceRatio(i.route));

  let compliantValue = 0;
  let verifiedValue = 0;
  let unverifiedValue = 0;

  for (const i of screenable) {
    const value = marketValueCad(i.holding, usdToCad);
    if (i.status === "COMPLIANT") {
      compliantValue += value;
      verifiedValue += value;
    } else if (i.status === "NOT_COMPLIANT") {
      verifiedValue += value;
    } else {
      unverifiedValue += value;
    }
  }

  // Portfolio totals cover everything, including the cash and crypto rows that
  // are excluded from the compliance ratio.
  let totalPortfolioValueCad = 0;
  let investedValueCad = 0;
  let cashValueCad = 0;
  const accountTotals = new Map<string, number>();

  for (const i of items) {
    const value = marketValueCad(i.holding, usdToCad);
    totalPortfolioValueCad += value;
    if (i.route === "cash") cashValueCad += value;
    else investedValueCad += value;

    const name = i.holding.accountName || "Account";
    accountTotals.set(name, (accountTotals.get(name) ?? 0) + value);
  }

  // Must use the same key as groupHoldings, otherwise the summary would count
  // ABX and ABX.TO as two assets while the table shows them as one.
  const distinctAssets = new Set(
    items.map((i) => `${normalizeTicker(i.holding.symbol)}::${i.holding.name.trim().toLowerCase()}`),
  ).size;

  const count = (s: ComplianceStatus) => screenable.filter((i) => i.status === s).length;

  const round2 = (n: number) => Math.round(n * 100) / 100;

  return {
    totalPositions: items.length,
    distinctAssets,
    totalPortfolioValueCad: round2(totalPortfolioValueCad),
    investedValueCad: round2(investedValueCad),
    cashValueCad: round2(cashValueCad),
    accounts: [...accountTotals.entries()]
      .map(([name, valueCad]) => ({ name, valueCad: round2(valueCad) }))
      .sort((a, b) => b.valueCad - a.valueCad),
    screenedPositions: screenable.length,
    compliantCount: count("COMPLIANT"),
    nonCompliantCount: count("NOT_COMPLIANT"),
    unresolvedCount: count("UNRESOLVED"),
    needsReviewCount: count("NEEDS_REVIEW"),
    // Deliberately by value, not count — one large non-compliant position
    // matters far more than several tiny compliant ones.
    compliantPctByValue:
      verifiedValue > 0 ? Math.round((compliantValue / verifiedValue) * 1000) / 10 : null,
    unverifiedValueCad: Math.round(unverifiedValue * 100) / 100,
    valuesFxNormalized: usdToCad !== null,
    purification: totalPurification(items.map((i) => i.purification)),
  };
}
