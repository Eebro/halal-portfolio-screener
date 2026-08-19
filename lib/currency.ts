/**
 * CAD normalization for a holding's market value.
 *
 * Pulled out of lib/scan.ts into its own module so it can be imported from
 * client components (like ZakatCalculator) without dragging in scan.ts's
 * server-only dependency chain (lib/screener/detail.ts uses node:fs/node:path
 * to cache screener pages, which Next.js cannot bundle for the browser).
 *
 * A real export mixes CAD and USD rows freely. Summing them raw would
 * overstate the CAD share of the portfolio and skew any percentage computed
 * from it, so everything is normalized to CAD before aggregation.
 */
import type { Holding } from "@/lib/types";

export function marketValueCad(holding: Holding, usdToCad: number | null): number {
  const value = Math.abs(holding.marketValue);
  const currency = (holding.marketValueCurrency || "CAD").toUpperCase();
  if (currency === "CAD") return value;
  if (currency === "USD" && usdToCad) return value * usdToCad;
  // Unknown currency with no rate: fall back to the CAD book value if the
  // broker gave us one, otherwise count at face value and flag it upstream.
  return holding.bookValueCad !== null ? Math.abs(holding.bookValueCad) : value;
}
