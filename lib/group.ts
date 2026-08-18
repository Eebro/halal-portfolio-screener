/**
 * Consolidates positions of the same asset held across multiple accounts.
 *
 * A real export lists one row per account, so the same holding appears several
 * times — WSHR, AEM.TO and SPUS each show up in three accounts in a typical
 * Wealthsimple file. Screening them as separate rows makes the table long and
 * makes "how much do I owe on this asset" a mental arithmetic exercise.
 *
 * Grouping keys on the normalized ticker plus asset name, so the same company
 * on the same exchange consolidates while genuinely different assets never do.
 */
import type { EtfEntry, ComplianceStatus, ScreenResult, ScreenedHolding } from "@/lib/types";
import { normalizeTicker } from "@/lib/screener/resolve";

export interface AccountPosition {
  accountName: string;
  quantity: number;
  marketValue: number;
  currency: string;
}

export interface GroupedHolding {
  key: string;
  /** Display symbol, taken from the first position (e.g. "AEM.TO"). */
  symbol: string;
  /** Asset name from the broker, e.g. "Agnico Eagle Mines Limited". */
  name: string;
  status: ComplianceStatus;
  route: ScreenedHolding["route"];
  screen: ScreenResult | null;
  etf: EtfEntry | null;
  explanation: string;
  candidates?: ScreenedHolding["candidates"];

  totalQuantity: number;
  /** Summed market value. Null when the same asset is held in mixed currencies. */
  totalMarketValue: number | null;
  currency: string;
  accounts: AccountPosition[];

  purificationAaoifiUsd: number | null;
  purificationDividendUsd: number | null;
  zakatUsd: number | null;
  purificationNotes: string[];
  /** True when positions of this asset disagreed on compliance — worth showing. */
  statusConflict: boolean;
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Sums, treating all-null as null rather than collapsing it to zero. */
function sumOrNull(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length === 0 ? null : round(present.reduce((a, b) => a + b, 0));
}

/**
 * Notes are taken from the position whose screening data the row displays, not
 * unioned across positions.
 *
 * The source sometimes carries more than one record for the same company on
 * near-identical exchanges, with marginally different ratios — two Barrick
 * positions can yield "0.19% of dividends" and "0.18% of dividends". Unioning
 * those reads like a contradiction. We show the notes belonging to the figures
 * on screen, and say plainly when the positions matched different records.
 */
function notesFor(positions: ScreenedHolding[]): string[] {
  const notes = [...new Set(positions[0].purification.notes)];

  const sources = new Set(
    positions.map((p) => p.screen?.sourceUrl).filter((u): u is string => Boolean(u)),
  );
  if (sources.size > 1) {
    notes.push(
      `The screener holds ${sources.size} separate records for this company with slightly different ratios; the figures above come from the closest match.`,
    );
  }

  return notes;
}

export function groupHoldings(items: ScreenedHolding[]): GroupedHolding[] {
  const buckets = new Map<string, ScreenedHolding[]>();

  for (const item of items) {
    const ticker = normalizeTicker(item.holding.symbol);
    // Include the name so two unrelated assets that share a ticker in the same
    // file never merge into one misleading row.
    const key = `${ticker}::${item.holding.name.trim().toLowerCase()}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }

  const out: GroupedHolding[] = [];

  for (const [key, positions] of buckets) {
    const first = positions[0];

    const currencies = new Set(
      positions.map((p) => (p.holding.marketValueCurrency || "CAD").toUpperCase()),
    );
    const currency = currencies.size === 1 ? [...currencies][0] : "MIXED";
    const totalMarketValue =
      currencies.size === 1
        ? round(positions.reduce((sum, p) => sum + p.holding.marketValue, 0))
        : null;

    const statuses = new Set(positions.map((p) => p.status));

    out.push({
      key,
      symbol: first.holding.symbol,
      name: first.holding.name,
      // Positions of one asset should agree; if they don't, surface the
      // stricter verdict rather than the first one we happened to see.
      status: statuses.has("NOT_COMPLIANT") ? "NOT_COMPLIANT" : first.status,
      statusConflict: statuses.size > 1,
      route: first.route,
      screen: first.screen,
      etf: first.etf,
      explanation: first.explanation,
      candidates: first.candidates,

      totalQuantity: round(
        positions.reduce((sum, p) => sum + p.holding.quantity, 0),
        6,
      ),
      totalMarketValue,
      currency,
      accounts: positions
        .map((p) => ({
          accountName: p.holding.accountName || "Account",
          quantity: p.holding.quantity,
          marketValue: p.holding.marketValue,
          currency: (p.holding.marketValueCurrency || "CAD").toUpperCase(),
        }))
        .sort((a, b) => Math.abs(b.marketValue) - Math.abs(a.marketValue)),

      purificationAaoifiUsd: sumOrNull(positions.map((p) => p.purification.aaoifiUsd)),
      purificationDividendUsd: sumOrNull(positions.map((p) => p.purification.dividendBasedUsd)),
      zakatUsd: sumOrNull(positions.map((p) => p.purification.zakatUsd)),
      purificationNotes: notesFor(positions),
    });
  }

  return out;
}
