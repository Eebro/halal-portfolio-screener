/**
 * 2026 federal and provincial/territorial marginal tax brackets, and the
 * marginal-tax calculator built on them.
 *
 * Source: CRA, "Current year tax rates and income brackets (2026)"
 * https://www.canada.ca/en/revenue-agency/services/tax/individuals/tax-rates-brackets/current-year.html
 * (pulled directly from that page for federal + every province/territory
 * except Quebec, which the CRA page itself defers to Revenu Québec for).
 *
 * Quebec: Revenu Québec, "Income Tax Rates" (2026 table)
 * https://www.revenuquebec.ca/en/citizens/income-tax-return/completing-your-income-tax-return/income-tax-rates/
 *
 * Quebec residents also receive a federal tax abatement (~16.5% reduction of
 * federal tax payable, since Quebec collects its own provincial tax
 * separately) — NOT modelled here. Combined-rate figures for Quebec are
 * therefore a slight overstatement of true marginal tax. Flagged in the UI
 * rather than silently absorbed, since modelling the abatement correctly
 * would need a second federal table just for one province.
 */

export type ProvinceCode =
  | "AB"
  | "BC"
  | "MB"
  | "NB"
  | "NL"
  | "NT"
  | "NS"
  | "NU"
  | "ON"
  | "PE"
  | "QC"
  | "SK"
  | "YT";

export interface Bracket {
  /** Upper bound of this bracket's income slice. `null` means no upper bound. */
  upTo: number | null;
  rate: number;
}

/** Federal brackets, 2026. */
export const FEDERAL_BRACKETS: Bracket[] = [
  { upTo: 58_523, rate: 0.14 },
  { upTo: 117_045, rate: 0.205 },
  { upTo: 181_440, rate: 0.26 },
  { upTo: 258_482, rate: 0.29 },
  { upTo: null, rate: 0.33 },
];

export const PROVINCIAL_BRACKETS: Record<ProvinceCode, Bracket[]> = {
  AB: [
    { upTo: 61_200, rate: 0.08 },
    { upTo: 154_259, rate: 0.1 },
    { upTo: 185_111, rate: 0.12 },
    { upTo: 246_813, rate: 0.13 },
    { upTo: 370_220, rate: 0.14 },
    { upTo: null, rate: 0.15 },
  ],
  BC: [
    { upTo: 50_363, rate: 0.056 },
    { upTo: 100_728, rate: 0.077 },
    { upTo: 115_648, rate: 0.105 },
    { upTo: 140_430, rate: 0.1229 },
    { upTo: 190_405, rate: 0.147 },
    { upTo: 265_545, rate: 0.168 },
    { upTo: null, rate: 0.205 },
  ],
  MB: [
    { upTo: 47_564, rate: 0.108 },
    { upTo: 101_200, rate: 0.1275 },
    { upTo: null, rate: 0.174 },
  ],
  NB: [
    { upTo: 52_333, rate: 0.094 },
    { upTo: 104_666, rate: 0.14 },
    { upTo: 193_861, rate: 0.16 },
    { upTo: null, rate: 0.195 },
  ],
  NL: [
    { upTo: 44_678, rate: 0.087 },
    { upTo: 89_354, rate: 0.145 },
    { upTo: 159_528, rate: 0.158 },
    { upTo: 223_340, rate: 0.178 },
    { upTo: 285_319, rate: 0.198 },
    { upTo: 570_638, rate: 0.208 },
    { upTo: 1_141_275, rate: 0.213 },
    { upTo: null, rate: 0.218 },
  ],
  NT: [
    { upTo: 53_003, rate: 0.059 },
    { upTo: 106_009, rate: 0.086 },
    { upTo: 172_346, rate: 0.122 },
    { upTo: null, rate: 0.1405 },
  ],
  NS: [
    { upTo: 30_995, rate: 0.0879 },
    { upTo: 61_991, rate: 0.1495 },
    { upTo: 97_417, rate: 0.1667 },
    { upTo: 157_124, rate: 0.175 },
    { upTo: null, rate: 0.21 },
  ],
  NU: [
    { upTo: 55_801, rate: 0.04 },
    { upTo: 111_602, rate: 0.07 },
    { upTo: 181_439, rate: 0.09 },
    { upTo: null, rate: 0.115 },
  ],
  ON: [
    { upTo: 53_891, rate: 0.0505 },
    { upTo: 107_785, rate: 0.0915 },
    { upTo: 150_000, rate: 0.1116 },
    { upTo: 220_000, rate: 0.1216 },
    { upTo: null, rate: 0.1316 },
  ],
  PE: [
    { upTo: 33_928, rate: 0.095 },
    { upTo: 65_820, rate: 0.1347 },
    { upTo: 106_890, rate: 0.166 },
    { upTo: 142_520, rate: 0.1762 },
    { upTo: 200_000, rate: 0.19 },
    { upTo: null, rate: 0.2 },
  ],
  QC: [
    { upTo: 54_345, rate: 0.14 },
    { upTo: 108_680, rate: 0.19 },
    { upTo: 132_245, rate: 0.24 },
    { upTo: null, rate: 0.2575 },
  ],
  SK: [
    { upTo: 54_532, rate: 0.105 },
    { upTo: 155_805, rate: 0.125 },
    { upTo: null, rate: 0.145 },
  ],
  YT: [
    { upTo: 58_523, rate: 0.064 },
    { upTo: 117_045, rate: 0.09 },
    { upTo: 181_440, rate: 0.109 },
    { upTo: 500_000, rate: 0.128 },
    { upTo: null, rate: 0.15 },
  ],
};

export const PROVINCE_LABELS: Record<ProvinceCode, string> = {
  AB: "Alberta",
  BC: "British Columbia",
  MB: "Manitoba",
  NB: "New Brunswick",
  NL: "Newfoundland and Labrador",
  NT: "Northwest Territories",
  NS: "Nova Scotia",
  NU: "Nunavut",
  ON: "Ontario",
  PE: "Prince Edward Island",
  QC: "Quebec",
  SK: "Saskatchewan",
  YT: "Yukon",
};

/**
 * Tax owed on the slice of income from `from` to `from + amount`, under a
 * single bracket table. This is the core "stacked, not flat-rate" logic: a
 * $30,000 withdrawal on top of $50,000 income does not get taxed entirely at
 * the rate for $80,000 — the portion of it that falls within each bracket is
 * taxed at that bracket's own rate.
 */
function taxOnSlice(brackets: Bracket[], from: number, amount: number): number {
  if (amount <= 0) return 0;

  const to = from + amount;
  let tax = 0;
  let lower = 0;

  for (const bracket of brackets) {
    const upper = bracket.upTo ?? Infinity;
    // Overlap between [from, to) and this bracket's [lower, upper) range.
    const sliceStart = Math.max(from, lower);
    const sliceEnd = Math.min(to, upper);
    if (sliceEnd > sliceStart) {
      tax += (sliceEnd - sliceStart) * bracket.rate;
    }
    lower = upper;
    if (lower >= to) break;
  }

  return tax;
}

/**
 * Combined federal + provincial tax owed on `amount`, when that amount is
 * stacked on top of `baseIncome` (e.g. an RRSP withdrawal added to a
 * person's existing annual income). Not a flat lookup of the rate at
 * `baseIncome` — the withdrawal is walked across whatever brackets it
 * actually spans, federally and provincially, matching how marginal tax
 * really works.
 */
export function marginalTaxOnAmount(
  baseIncome: number,
  amount: number,
  province: ProvinceCode,
): number {
  const base = Math.max(0, baseIncome);
  const federal = taxOnSlice(FEDERAL_BRACKETS, base, amount);
  const provincial = taxOnSlice(PROVINCIAL_BRACKETS[province], base, amount);
  return federal + provincial;
}

/**
 * The effective rate `marginalTaxOnAmount` works out to, for display (e.g.
 * "this withdrawal is taxed at an effective 31.5%"). Returns 0 for a
 * non-positive amount rather than dividing by zero.
 */
export function effectiveMarginalRate(
  baseIncome: number,
  amount: number,
  province: ProvinceCode,
): number {
  if (amount <= 0) return 0;
  return marginalTaxOnAmount(baseIncome, amount, province) / amount;
}
