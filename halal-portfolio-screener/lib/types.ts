/**
 * Core domain types.
 *
 * A note on nullability that matters for correctness: several screener fields
 * are legitimately "not applicable" rather than zero. A non-compliant stock
 * renders "-" for impure income, which must become `null`, never `0` — `0`
 * would read as "nothing to purify", the opposite of the truth.
 */

/** Wealthsimple's `Security Type` column, which drives how we screen a row. */
export type SecurityType =
  | "EQUITY"
  | "EXCHANGE_TRADED_FUND"
  | "CURRENCY"
  | "CRYPTOCURRENCY"
  | "PRECIOUS_METAL";

/** A single position, normalized from either a CSV upload or SnapTrade. */
export interface Holding {
  /** Raw symbol as the broker reported it, e.g. "AEM.TO" or "ABX". */
  symbol: string;
  /** Company/fund name as the broker reported it. Used to break ticker ties. */
  name: string;
  securityType: SecurityType;
  /** ISO 10383 Market Identifier Code, e.g. "XTSE". Empty for cash/crypto. */
  mic: string;
  /** Broker's human-readable exchange label, e.g. "TSX". Fallback for `mic`. */
  exchange: string;
  quantity: number;
  /** "LONG" | "SHORT" — shorts need separate treatment and are flagged. */
  direction: string;
  marketPrice: number;
  marketPriceCurrency: string;
  marketValue: number;
  marketValueCurrency: string;
  /** CAD-normalized book value; the anchor for cross-currency totals. */
  bookValueCad: number | null;
  /** Account label, e.g. "TFSA". Enables per-account grouping in the UI. */
  accountName: string;
  accountType: string;
}

/** How a holding was routed for screening. */
export type ScreenRoute =
  | "stock" // screened against the SP Funds stock screener
  | "etf" // resolved via the curated ETF registry
  | "cash" // currency row; neutral, excluded from screening
  | "informational"; // crypto / precious metal; no verdict asserted

export type ComplianceStatus =
  | "COMPLIANT"
  | "NOT_COMPLIANT"
  /** Screenable in principle, but we could not resolve it to a record. */
  | "UNRESOLVED"
  /** Not a screenable security (cash) or intentionally unjudged (crypto). */
  | "NOT_SCREENABLE"
  /** Known asset class but no vetted data — e.g. an ETF not in the registry. */
  | "NEEDS_REVIEW";

/** One row of the five-methodology ratio table on a detail page. */
export interface MethodologyRatios {
  methodology: "AAOIFI" | "S&P" | "DJIM" | "FTSE" | "MSCI";
  /** Interest-bearing debt ratio. Denominator varies by methodology. */
  debtPct: number | null;
  nonCompliantAssetsPct: number | null;
  impureIncomePct: number | null;
}

/** Parsed result of a single stock detail page. */
export interface ScreenResult {
  ticker: string;
  companyName: string;
  status: "COMPLIANT" | "NOT_COMPLIANT";
  /** Plain-English verdict sentence from the source. */
  summary: string;
  /** For non-compliant stocks, the offending activity, e.g. "Banks (NEC)". */
  nonComplianceReason: string | null;
  /**
   * How many of the screened standards this passes, e.g. 3 of 5.
   *
   * This matters more than it looks: the headline verdict tracks the primary
   * (AAOIFI) standard, so a stock can read "Compliant" while passing as few as
   * 1 of 5 — Camden Property Trust is 1/5, PepsiCo is 3/5. Showing the badge
   * alone would overstate how settled the verdict is.
   */
  standardsPassed: number | null;
  standardsTotal: number | null;
  impureIncomePct: number | null;
  /** USD per share, AAOIFI basis, owed each financial period (quarterly). */
  purificationPerShareUsd: number | null;
  /** USD per share. */
  zakatPerShareUsd: number | null;
  ratios: MethodologyRatios[];
  /** Breakdown of where impure income comes from. */
  impureIncomeBreakdown: { category: string; pct: number | null }[];
  exchange: string | null;
  sector: string | null;
  /** The source's own "Updated on" date — surfaced so staleness is visible. */
  updatedOn: string | null;
  sourceUrl: string;
}

/** An entry in the curated ETF registry. */
export interface EtfEntry {
  ticker: string;
  name: string;
  provider: string;
  shariahCompliant: boolean;
  /** Purification as a percentage of dividends, most recent published quarter. */
  purificationRatePct: number | null;
  /** e.g. "Q1 2026" — shown so users know the vintage. */
  ratePeriod: string | null;
  note: string | null;
  sourceUrl: string;
}

export interface PurificationBreakdown {
  /** purificationPerShareUsd x quantity. Owed per financial period. */
  aaoifiUsd: number | null;
  /** impureIncomePct x dividends received. Null when dividends are unknown. */
  dividendBasedUsd: number | null;
  /** zakatPerShareUsd x quantity. */
  zakatUsd: number | null;
  /**
   * Why a figure is null, so the UI can explain rather than show a blank.
   * e.g. "no dividend data — enter dividends received to compute".
   */
  notes: string[];
}

/** A holding after screening: the shape the dashboard renders. */
export interface ScreenedHolding {
  holding: Holding;
  route: ScreenRoute;
  status: ComplianceStatus;
  /** Present when route === "stock" and resolution succeeded. */
  screen: ScreenResult | null;
  /** Present when route === "etf" and the ticker is in the registry. */
  etf: EtfEntry | null;
  purification: PurificationBreakdown;
  /** Human-readable explanation of the status, always populated. */
  explanation: string;
  /** Candidate matches when status is UNRESOLVED, for the manual picker. */
  candidates?: { ticker: string; name: string; slug: string; exchange: string }[];
}
