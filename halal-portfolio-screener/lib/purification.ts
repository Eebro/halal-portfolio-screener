/**
 * Purification and zakat calculations.
 *
 * The source publishes two different bases, and they answer different
 * questions, so we compute both rather than picking one:
 *
 *  - AAOIFI: a USD-per-share amount owed EVERY financial period (e.g.
 *    quarterly), whether or not the company paid a dividend. We report the
 *    current period's figure and deliberately do NOT annualize it — the source
 *    publishes one period's rate and multiplying it by four would be our
 *    invention, not their guidance.
 *
 *  - S&P (dividend-only): impure income percentage applied to dividends
 *    actually received. Nothing is owed on a non-dividend-paying stock. This
 *    needs dividend data, which a CSV export does not contain, so it stays
 *    null until the user supplies it.
 *
 * ETFs work on the dividend basis only, using the fund's published quarterly
 * purification rate.
 *
 * Everything here is in USD, because that is the unit the source publishes.
 * Conversion happens at the display layer so the mixing is explicit.
 */
import type { EtfEntry, Holding, PurificationBreakdown, ScreenResult } from "@/lib/types";

export interface PurificationInput {
  holding: Holding;
  screen?: ScreenResult | null;
  etf?: EtfEntry | null;
  /** Dividends received for this position, in USD. Optional. */
  dividendsReceivedUsd?: number | null;
}

/** Guards against floating-point noise like 0.30000000000000004 in the UI. */
function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export function computePurification(input: PurificationInput): PurificationBreakdown {
  const { holding, screen, etf } = input;
  const dividends = input.dividendsReceivedUsd ?? null;
  const notes: string[] = [];

  const qty = Math.abs(holding.quantity);

  let aaoifiUsd: number | null = null;
  let dividendBasedUsd: number | null = null;
  let zakatUsd: number | null = null;

  if (screen) {
    if (screen.purificationPerShareUsd !== null) {
      aaoifiUsd = round(screen.purificationPerShareUsd * qty);
    } else {
      notes.push("The screener publishes no per-share purification figure for this holding.");
    }

    if (screen.zakatPerShareUsd !== null) {
      zakatUsd = round(screen.zakatPerShareUsd * qty);
    }

    if (screen.impureIncomePct === null) {
      notes.push(
        "No impure-income percentage is published, so dividend-based purification cannot be computed.",
      );
    } else if (dividends === null) {
      notes.push(
        `Dividend-based purification is ${screen.impureIncomePct}% of dividends received — enter your dividends to compute it.`,
      );
    } else {
      dividendBasedUsd = round((screen.impureIncomePct / 100) * dividends);
    }
  } else if (etf) {
    // Funds publish a rate against dividends; there is no per-share AAOIFI
    // figure, so leaving aaoifiUsd null is correct rather than a gap.
    notes.push("Funds are purified on dividends received, not per share.");

    if (etf.purificationRatePct === null) {
      notes.push(
        `No published purification rate for ${etf.ticker} in the registry — check ${etf.provider}'s fund page.`,
      );
    } else if (etf.purificationRatePct === 0) {
      dividendBasedUsd = 0;
      if (etf.note) notes.push(etf.note);
    } else if (dividends === null) {
      notes.push(
        `Purification is ${etf.purificationRatePct}% of dividends received${
          etf.ratePeriod ? ` (${etf.ratePeriod} rate)` : ""
        } — enter your dividends to compute it.`,
      );
    } else {
      dividendBasedUsd = round((etf.purificationRatePct / 100) * dividends);
    }
  }

  if (holding.direction && holding.direction !== "LONG") {
    notes.push(`Position is ${holding.direction}; purification for non-long positions is not modelled.`);
  }

  return { aaoifiUsd, dividendBasedUsd, zakatUsd, notes };
}

export interface PortfolioTotals {
  /** Sum of AAOIFI per-period purification, USD. */
  aaoifiUsd: number;
  /** Sum of dividend-based purification actually computable, USD. */
  dividendBasedUsd: number;
  zakatUsd: number;
  /** Positions whose purification could not be computed for lack of data. */
  incompleteCount: number;
}

export function totalPurification(items: PurificationBreakdown[]): PortfolioTotals {
  let aaoifiUsd = 0;
  let dividendBasedUsd = 0;
  let zakatUsd = 0;
  let incompleteCount = 0;

  for (const it of items) {
    if (it.aaoifiUsd !== null) aaoifiUsd += it.aaoifiUsd;
    if (it.dividendBasedUsd !== null) dividendBasedUsd += it.dividendBasedUsd;
    if (it.zakatUsd !== null) zakatUsd += it.zakatUsd;
    if (it.aaoifiUsd === null && it.dividendBasedUsd === null) incompleteCount++;
  }

  return {
    aaoifiUsd: round(aaoifiUsd),
    dividendBasedUsd: round(dividendBasedUsd),
    zakatUsd: round(zakatUsd),
    incompleteCount,
  };
}

/**
 * Zakat on trading-intent holdings: 2.5% of market value once a lunar year has
 * passed. Offered alongside the per-share long-term figure because the source
 * explicitly distinguishes the two treatments.
 */
export function zakatOnTradingValue(marketValue: number): number {
  return round(marketValue * 0.025);
}
