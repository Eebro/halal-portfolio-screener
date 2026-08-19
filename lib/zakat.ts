/**
 * Zakat al-Mal (2.5% annual wealth tax) on a Canadian investment portfolio.
 *
 * This is a portfolio-level wealth calculation, distinct from
 * lib/purification.ts (per-holding cleanup of tainted income) — it answers a
 * different question and is triggered separately, once the user supplies
 * their annual income and province.
 *
 * The core idea: 2.5% of gross market value overstates what's owed, because
 * a large share of a typical Wealthsimple portfolio sits in tax-deferred
 * accounts. Withdrawing an RRSP or FHSA today triggers real income tax at the
 * person's marginal rate — that portion was never really "yours" to begin
 * with, so zakat is computed on the NET (after-tax) value, not the gross
 * balance. TFSA withdrawals are tax-free, so TFSA counts at full value.
 * Non-registered accounts trigger capital gains tax (50% inclusion, 2026) on
 * the unrealized gain if sold — not full-value tax, since the cost basis was
 * already after-tax money.
 *
 * This mirrors the National Zakat Foundation Canada's own published RRSP
 * methodology (deduct the tax owed on withdrawal, zakat the net) —
 * https://www.nzfcanada.com/zakat-faq/how-do-i-calculate-zakat-on-my-retirement-savings-rrsp-and-tfsa
 * — except NZF's worked example uses the flat CRA withholding-tax tiers
 * (10/20/30%) as a stand-in for tax owed. Withholding is only a prepayment
 * estimate, not the final tax bill: the withdrawal is added to the person's
 * income and taxed at their real marginal rate when they file. This module
 * computes that marginal rate directly from stated income + province
 * (lib/tax/brackets.ts) rather than using the withholding tiers, which is
 * more accurate but not what NZF's own example literally does — surfaced in
 * the UI rather than silently diverging from the cited precedent.
 *
 * This is also a genuinely disputed fiqh question. The Fiqh Council of North
 * America rejects any tax/penalty deduction on retirement accounts, on the
 * grounds that the liability doesn't exist until the withdrawal actually
 * happens. This module states its methodology and cites both positions
 * rather than asserting a ruling — the same honesty pattern already used for
 * AAOIFI vs S&P purification elsewhere in this app.
 */
import { effectiveMarginalRate, marginalTaxOnAmount, type ProvinceCode } from "@/lib/tax/brackets";
import { classifyAccountType, type AccountTaxCategory } from "@/lib/tax/accountType";
import { marketValueCad } from "@/lib/currency";
import type { ScreenedHolding } from "@/lib/types";

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export interface ZakatInput {
  holdings: ScreenedHolding[];
  annualIncomeCad: number;
  province: ProvinceCode;
  usdToCad: number | null;
}

/** One line of the "show your work" breakdown for a single holding. */
export interface ZakatLineItem {
  symbol: string;
  name: string;
  accountName: string;
  category: AccountTaxCategory;
  grossValueCad: number;
  /** Tax that would be owed on liquidating this position today. */
  taxCad: number;
  netValueCad: number;
  /** The marginal rate actually applied, for RRSP/FHSA lines. */
  marginalRateApplied: number | null;
  /** The capital gain the tax was computed on, for non-registered lines. */
  capitalGainCad: number | null;
  /** Plain-language explanation of the arithmetic performed for this line. */
  explanation: string;
}

/** Aggregated totals for one account-tax-category, for the summary table. */
export interface ZakatCategoryTotal {
  category: AccountTaxCategory;
  grossValueCad: number;
  taxCad: number;
  netValueCad: number;
}

export interface ZakatBreakdown {
  lineItems: ZakatLineItem[];
  categoryTotals: ZakatCategoryTotal[];
  totalGrossCad: number;
  totalTaxCad: number;
  /** The zakatable base: total gross minus tax haircuts. */
  netZakatableCad: number;
  /** 2.5% of netZakatableCad. */
  zakatDueCad: number;
  /**
   * The person's marginal tax rate (federal + provincial, %) on the next
   * dollar of ordinary income at their stated income — i.e. their current
   * tax bracket, before any withdrawal is added. Each line item's own rate
   * (marginalRateApplied) can differ from this, since a large RRSP
   * withdrawal or a capital gain slice pushes further up the brackets than
   * the first dollar does — this is the headline "your bracket" figure.
   */
  marginalRateAtIncomePct: number;
  /** Positions where a haircut couldn't be computed precisely (e.g. no cost basis). */
  notes: string[];
}

const CAPITAL_GAINS_INCLUSION_RATE = 0.5; // 2026, confirmed unchanged (50%, not the cancelled 66.67% proposal).
const ZAKAT_RATE = 0.025;

/**
 * Computes the after-tax value of one holding if liquidated today, plus the
 * arithmetic behind it, so the UI can show its work rather than presenting a
 * black-box number.
 */
function computeLineItem(
  screened: ScreenedHolding,
  annualIncomeCad: number,
  province: ProvinceCode,
  usdToCad: number | null,
  notes: string[],
): ZakatLineItem {
  const holding = screened.holding;
  const category = classifyAccountType(holding);
  const grossValueCad = round(marketValueCad(holding, usdToCad));

  if (category === "RRSP" || category === "FHSA") {
    const rate = effectiveMarginalRate(annualIncomeCad, grossValueCad, province);
    const taxCad = round(marginalTaxOnAmount(annualIncomeCad, grossValueCad, province));
    const netValueCad = round(grossValueCad - taxCad);
    return {
      symbol: holding.symbol,
      name: holding.name,
      accountName: holding.accountName,
      category,
      grossValueCad,
      taxCad,
      netValueCad,
      marginalRateApplied: round(rate * 100, 1),
      capitalGainCad: null,
      explanation:
        `$${grossValueCad.toLocaleString()} gross → your marginal rate on this withdrawal ` +
        `(stacked on $${annualIncomeCad.toLocaleString()} income) is ${round(rate * 100, 1)}% → ` +
        `tax owed $${taxCad.toLocaleString()} → net zakatable $${netValueCad.toLocaleString()}`,
    };
  }

  if (category === "TFSA") {
    return {
      symbol: holding.symbol,
      name: holding.name,
      accountName: holding.accountName,
      category,
      grossValueCad,
      taxCad: 0,
      netValueCad: grossValueCad,
      marginalRateApplied: null,
      capitalGainCad: null,
      explanation: `$${grossValueCad.toLocaleString()} — no tax on withdrawal, full value counts`,
    };
  }

  // Cash is never capital property — there is no gain to realize on holding
  // currency, in any account. This must be checked before the capital-gains
  // branch below: a cash position can carry a non-null bookValueCad (e.g.
  // book value roughly equal to face value), and without this check it would
  // be run through capital-gains math for no reason, or worse, produce a
  // nonzero "gain" purely from FX/rounding noise between market and book
  // value on a currency row.
  if (holding.securityType === "CURRENCY") {
    return {
      symbol: holding.symbol,
      name: holding.name,
      accountName: holding.accountName,
      category,
      grossValueCad,
      taxCad: 0,
      netValueCad: grossValueCad,
      marginalRateApplied: null,
      capitalGainCad: null,
      explanation: `$${grossValueCad.toLocaleString()} — cash, no gain to tax, full value counts`,
    };
  }

  // NON_REGISTERED and OTHER, holding capital property (stocks, ETFs, crypto,
  // physically-backed metal — all genuinely trigger capital gains tax on
  // disposition in Canada, not just non-registered brokerage holdings):
  // capital gains tax on the unrealized gain when a cost basis is known;
  // otherwise full value, since guessing a gain would be worse than being
  // transparent that one wasn't computed.
  const bookValueCad = holding.bookValueCad;
  if (bookValueCad === null || bookValueCad <= 0) {
    if (category === "NON_REGISTERED") {
      notes.push(
        `${holding.symbol} (${holding.accountName}): no cost basis available, so the capital-gains ` +
          `haircut could not be computed — counted at full market value instead, which may overstate ` +
          `what's actually zakatable.`,
      );
    }
    return {
      symbol: holding.symbol,
      name: holding.name,
      accountName: holding.accountName,
      category,
      grossValueCad,
      taxCad: 0,
      netValueCad: grossValueCad,
      marginalRateApplied: null,
      capitalGainCad: null,
      explanation:
        category === "NON_REGISTERED"
          ? `$${grossValueCad.toLocaleString()} — cost basis unavailable, counted at full value`
          : `$${grossValueCad.toLocaleString()} — full value counts`,
    };
  }

  const gainCad = Math.max(0, grossValueCad - bookValueCad);
  const taxableGainCad = gainCad * CAPITAL_GAINS_INCLUSION_RATE;
  const taxCad = round(marginalTaxOnAmount(annualIncomeCad, taxableGainCad, province));
  const netValueCad = round(grossValueCad - taxCad);
  // Same "stacked on top of income" marginal rate as RRSP/FHSA, just applied
  // to the taxable half of the gain instead of the full withdrawal — worth
  // surfacing here too rather than only for registered accounts.
  const rate = taxableGainCad > 0 ? effectiveMarginalRate(annualIncomeCad, taxableGainCad, province) : 0;

  return {
    symbol: holding.symbol,
    name: holding.name,
    accountName: holding.accountName,
    category,
    grossValueCad,
    taxCad,
    netValueCad,
    marginalRateApplied: taxableGainCad > 0 ? round(rate * 100, 1) : null,
    capitalGainCad: round(gainCad),
    explanation:
      `$${grossValueCad.toLocaleString()} market value, $${round(bookValueCad).toLocaleString()} cost basis → ` +
      `$${round(gainCad).toLocaleString()} gain × ${CAPITAL_GAINS_INCLUSION_RATE * 100}% inclusion = ` +
      `$${round(taxableGainCad).toLocaleString()} taxable → tax at your marginal rate` +
      (taxableGainCad > 0 ? ` (${round(rate * 100, 1)}%)` : "") +
      ` $${taxCad.toLocaleString()} → net zakatable $${netValueCad.toLocaleString()}`,
  };
}

export function computeZakat(input: ZakatInput): ZakatBreakdown {
  const notes: string[] = [];
  const lineItems = input.holdings.map((h) =>
    computeLineItem(h, input.annualIncomeCad, input.province, input.usdToCad, notes),
  );

  const categoryMap = new Map<AccountTaxCategory, ZakatCategoryTotal>();
  for (const item of lineItems) {
    const existing = categoryMap.get(item.category);
    if (existing) {
      existing.grossValueCad = round(existing.grossValueCad + item.grossValueCad);
      existing.taxCad = round(existing.taxCad + item.taxCad);
      existing.netValueCad = round(existing.netValueCad + item.netValueCad);
    } else {
      categoryMap.set(item.category, {
        category: item.category,
        grossValueCad: item.grossValueCad,
        taxCad: item.taxCad,
        netValueCad: item.netValueCad,
      });
    }
  }

  const totalGrossCad = round(lineItems.reduce((sum, i) => sum + i.grossValueCad, 0));
  const totalTaxCad = round(lineItems.reduce((sum, i) => sum + i.taxCad, 0));
  const netZakatableCad = round(totalGrossCad - totalTaxCad);
  const zakatDueCad = round(netZakatableCad * ZAKAT_RATE);
  // Rate on a single incremental dollar at the stated income — the person's
  // current tax bracket, independent of how large any one withdrawal is.
  const marginalRateAtIncomePct = round(
    effectiveMarginalRate(input.annualIncomeCad, 1, input.province) * 100,
    1,
  );

  // Sort categories in a stable, meaningful order for display: tax-advantaged
  // accounts first (the interesting cases), then taxable, then other.
  const order: AccountTaxCategory[] = ["TFSA", "RRSP", "FHSA", "NON_REGISTERED", "OTHER"];
  const categoryTotals = order
    .map((c) => categoryMap.get(c))
    .filter((c): c is ZakatCategoryTotal => c !== undefined);

  return {
    lineItems,
    categoryTotals,
    totalGrossCad,
    totalTaxCad,
    netZakatableCad,
    zakatDueCad,
    marginalRateAtIncomePct,
    notes,
  };
}
