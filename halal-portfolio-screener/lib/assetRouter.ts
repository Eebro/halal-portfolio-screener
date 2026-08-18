/**
 * Decides how each holding gets screened.
 *
 * A brokerage export is not a list of stocks. A real Wealthsimple file mixes
 * equities, ETFs, cash balances, crypto and physically-backed metal — and the
 * stock screener only covers the first of those. Routing wrongly here would
 * either drop positions silently or assert verdicts we have no basis for.
 */
import type { Holding, ScreenRoute } from "@/lib/types";

export interface RoutingDecision {
  route: ScreenRoute;
  /** Shown to the user when no verdict is produced. */
  explanation: string;
}

export function routeHolding(holding: Holding): RoutingDecision {
  switch (holding.securityType) {
    case "EQUITY":
      return { route: "stock", explanation: "" };

    case "EXCHANGE_TRADED_FUND":
      return { route: "etf", explanation: "" };

    case "CURRENCY":
      return {
        route: "cash",
        explanation:
          "Cash balance. Holding currency is permissible, so there is nothing to screen or purify — though it does count toward zakat.",
      };

    case "PRECIOUS_METAL":
      return {
        route: "informational",
        explanation:
          "Physically-backed precious metal. Generally treated as permissible when fully allocated and physically backed; it counts toward zakat at 2.5% of market value.",
      };

    case "CRYPTOCURRENCY":
      return {
        route: "informational",
        explanation:
          "Cryptocurrency. Scholarly opinion is genuinely divided on this and no screener verdict applies, so this app does not assert one — consult a scholar you trust.",
      };

    default:
      return {
        route: "informational",
        explanation: "Unrecognized asset type; not screened.",
      };
  }
}

/** Cash rows are excluded from the "% compliant" denominator. */
export function countsTowardComplianceRatio(route: ScreenRoute): boolean {
  return route === "stock" || route === "etf";
}
