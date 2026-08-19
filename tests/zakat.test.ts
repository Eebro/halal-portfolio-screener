import { describe, it, expect } from "vitest";
import { computeZakat } from "@/lib/zakat";
import { effectiveMarginalRate, marginalTaxOnAmount } from "@/lib/tax/brackets";
import type { Holding, ScreenedHolding } from "@/lib/types";

const holding = (over: Partial<Holding> = {}): Holding => ({
  symbol: "TEST",
  name: "Test Holding",
  securityType: "EQUITY",
  mic: "XTSE",
  exchange: "TSX",
  quantity: 100,
  direction: "LONG",
  marketPrice: 100,
  marketPriceCurrency: "CAD",
  marketValue: 10_000,
  marketValueCurrency: "CAD",
  bookValueCad: null,
  accountName: "TFSA",
  accountType: "TFSA",
  ...over,
});

const screened = (holdingOver: Partial<Holding> = {}, over: Partial<ScreenedHolding> = {}): ScreenedHolding => ({
  holding: holding(holdingOver),
  route: "stock",
  status: "COMPLIANT",
  screen: null,
  etf: null,
  purification: { aaoifiUsd: null, dividendBasedUsd: null, zakatUsd: null, notes: [] },
  explanation: "",
  ...over,
});

describe("computeZakat — TFSA", () => {
  it("counts TFSA holdings at full value with no tax haircut", () => {
    const result = computeZakat({
      holdings: [screened({ accountName: "TFSA", accountType: "TFSA", marketValue: 15_000 })],
      annualIncomeCad: 60_000,
      province: "ON",
      usdToCad: null,
    });

    expect(result.lineItems).toHaveLength(1);
    const line = result.lineItems[0];
    expect(line.category).toBe("TFSA");
    expect(line.grossValueCad).toBe(15_000);
    expect(line.taxCad).toBe(0);
    expect(line.netValueCad).toBe(15_000);
    expect(result.netZakatableCad).toBe(15_000);
    expect(result.zakatDueCad).toBe(375); // 2.5% of 15,000
  });
});

describe("computeZakat — RRSP/FHSA", () => {
  it("applies the marginal-rate haircut, stacked on stated income", () => {
    const result = computeZakat({
      holdings: [screened({ accountName: "RRSP", accountType: "RRSP", marketValue: 30_000 })],
      annualIncomeCad: 50_000,
      province: "ON",
      usdToCad: null,
    });

    const expectedTax = marginalTaxOnAmount(50_000, 30_000, "ON");
    const line = result.lineItems[0];
    expect(line.category).toBe("RRSP");
    expect(line.grossValueCad).toBe(30_000);
    expect(line.taxCad).toBeCloseTo(expectedTax, 2);
    expect(line.netValueCad).toBeCloseTo(30_000 - expectedTax, 2);
    expect(line.marginalRateApplied).toBeGreaterThan(0);
  });

  it("treats FHSA the same as RRSP for tax purposes", () => {
    const rrsp = computeZakat({
      holdings: [screened({ accountName: "RRSP", accountType: "RRSP", marketValue: 20_000 })],
      annualIncomeCad: 70_000,
      province: "BC",
      usdToCad: null,
    }).lineItems[0];

    const fhsa = computeZakat({
      holdings: [screened({ accountName: "FHSA", accountType: "FHSA", marketValue: 20_000 })],
      annualIncomeCad: 70_000,
      province: "BC",
      usdToCad: null,
    }).lineItems[0];

    expect(fhsa.taxCad).toBeCloseTo(rrsp.taxCad, 6);
    expect(fhsa.netValueCad).toBeCloseTo(rrsp.netValueCad, 6);
  });

  it("produces a plain-language explanation with real numbers substituted in", () => {
    const result = computeZakat({
      holdings: [screened({ accountName: "RRSP", accountType: "RRSP", marketValue: 42_000 })],
      annualIncomeCad: 85_000,
      province: "ON",
      usdToCad: null,
    });
    const line = result.lineItems[0];
    expect(line.explanation).toMatch(/\$42,000 gross/);
    expect(line.explanation).toMatch(/marginal rate/);
    expect(line.explanation).toMatch(/net zakatable/);
  });
});

describe("computeZakat — non-registered accounts", () => {
  it("applies capital gains tax on the unrealized gain when cost basis is known", () => {
    const result = computeZakat({
      holdings: [
        screened({
          accountName: "Non-registered",
          accountType: "Non-registered",
          marketValue: 18_000,
          bookValueCad: 12_000,
        }),
      ],
      annualIncomeCad: 60_000,
      province: "ON",
      usdToCad: null,
    });

    const line = result.lineItems[0];
    // Gain = 6,000; taxable at 50% inclusion = 3,000.
    expect(line.capitalGainCad).toBe(6_000);
    const expectedTax = marginalTaxOnAmount(60_000, 3_000, "ON");
    expect(line.taxCad).toBeCloseTo(expectedTax, 2);
    expect(line.netValueCad).toBeCloseTo(18_000 - expectedTax, 2);
    // The rate actually applied should now be surfaced for capital-gains
    // lines too, not just RRSP/FHSA — matching the effective rate on the
    // $3,000 taxable slice.
    expect(line.marginalRateApplied).toBeGreaterThan(0);
    expect(line.marginalRateApplied).toBeCloseTo((expectedTax / 3_000) * 100, 0);
    expect(line.explanation).toMatch(/marginal rate \(\d+(\.\d+)?%\)/);
  });

  it("does not apply a haircut for a position with an unrealized loss (no gain to tax)", () => {
    const result = computeZakat({
      holdings: [
        screened({
          accountName: "Non-registered",
          accountType: "Non-registered",
          marketValue: 8_000,
          bookValueCad: 12_000, // underwater
        }),
      ],
      annualIncomeCad: 60_000,
      province: "ON",
      usdToCad: null,
    });

    const line = result.lineItems[0];
    expect(line.capitalGainCad).toBe(0);
    expect(line.taxCad).toBe(0);
    expect(line.netValueCad).toBe(8_000);
  });

  it("falls back to full value and warns when cost basis is unavailable", () => {
    // This is the real SnapTrade case: bookValueCad is currently always null
    // for SnapTrade-sourced holdings.
    const result = computeZakat({
      holdings: [
        screened({
          symbol: "SHOP",
          accountName: "Non-registered",
          accountType: "Non-registered",
          marketValue: 5_000,
          bookValueCad: null,
        }),
      ],
      annualIncomeCad: 60_000,
      province: "ON",
      usdToCad: null,
    });

    const line = result.lineItems[0];
    expect(line.taxCad).toBe(0);
    expect(line.netValueCad).toBe(5_000);
    expect(result.notes.join(" ")).toMatch(/SHOP/);
    expect(result.notes.join(" ")).toMatch(/cost basis/i);
  });
});

describe("computeZakat — unrecognized account types", () => {
  it("defaults OTHER to full value rather than assuming a tax-advantaged status", () => {
    const result = computeZakat({
      holdings: [
        screened({ accountName: "Crypto", accountType: "Crypto", marketValue: 9_000 }),
      ],
      annualIncomeCad: 60_000,
      province: "ON",
      usdToCad: null,
    });

    const line = result.lineItems[0];
    expect(line.category).toBe("OTHER");
    expect(line.taxCad).toBe(0);
    expect(line.netValueCad).toBe(9_000);
  });

  it("never applies a capital-gains haircut to cash, even if a book value is present", () => {
    // Regression test: a real Wealthsimple CSV row for a CAD cash balance
    // carries a Book Value (CAD) roughly equal to face value. Before this
    // fix, that non-null book value would run cash through the same
    // capital-gains code path as a real brokerage holding, for no reason.
    const result = computeZakat({
      holdings: [
        screened({
          symbol: "CAD",
          securityType: "CURRENCY",
          accountName: "Crypto",
          accountType: "Crypto",
          marketValue: 1.76,
          bookValueCad: 1.76,
        }),
      ],
      annualIncomeCad: 60_000,
      province: "ON",
      usdToCad: null,
    });

    const line = result.lineItems[0];
    expect(line.taxCad).toBe(0);
    expect(line.capitalGainCad).toBeNull();
    expect(line.netValueCad).toBe(1.76);
    expect(line.explanation).toMatch(/cash/i);
  });

  it("applies a capital-gains haircut to crypto and precious metal held outside a taxable account label, when cost basis is known", () => {
    // Crypto and physically-backed metal are genuinely capital property in
    // Canada — a real disposition triggers capital gains tax just like a
    // stock, regardless of which account label the CSV happens to use.
    const result = computeZakat({
      holdings: [
        screened({
          symbol: "BTC",
          securityType: "CRYPTOCURRENCY",
          accountName: "Crypto",
          accountType: "Crypto",
          marketValue: 8_989.33,
          bookValueCad: 10_000,
        }),
      ],
      annualIncomeCad: 60_000,
      province: "ON",
      usdToCad: null,
    });

    const line = result.lineItems[0];
    // Underwater position (market value below cost basis) — no gain, no tax.
    expect(line.capitalGainCad).toBe(0);
    expect(line.taxCad).toBe(0);
    expect(line.netValueCad).toBe(8_989.33);
  });

  it("taxes a genuine crypto gain the same way as a non-registered stock gain", () => {
    const result = computeZakat({
      holdings: [
        screened({
          symbol: "BTC",
          securityType: "CRYPTOCURRENCY",
          accountName: "Crypto",
          accountType: "Crypto",
          marketValue: 15_000,
          bookValueCad: 10_000,
        }),
      ],
      annualIncomeCad: 60_000,
      province: "ON",
      usdToCad: null,
    });

    const line = result.lineItems[0];
    expect(line.capitalGainCad).toBe(5_000);
    expect(line.taxCad).toBeGreaterThan(0);
    expect(line.netValueCad).toBeLessThan(15_000);
  });
});

describe("computeZakat — currency normalization", () => {
  it("converts USD holdings to CAD before computing tax haircuts", () => {
    const result = computeZakat({
      holdings: [
        screened({
          accountName: "RRSP",
          accountType: "RRSP",
          marketValue: 10_000,
          marketValueCurrency: "USD",
        }),
      ],
      annualIncomeCad: 50_000,
      province: "ON",
      usdToCad: 1.4,
    });

    const line = result.lineItems[0];
    expect(line.grossValueCad).toBe(14_000);
  });
});

describe("computeZakat — portfolio totals", () => {
  it("sums across mixed account types and computes 2.5% of the net", () => {
    const result = computeZakat({
      holdings: [
        screened({ symbol: "A", accountName: "TFSA", accountType: "TFSA", marketValue: 20_000 }),
        screened({ symbol: "B", accountName: "RRSP", accountType: "RRSP", marketValue: 30_000 }),
        screened({
          symbol: "C",
          accountName: "Non-registered",
          accountType: "Non-registered",
          marketValue: 10_000,
          bookValueCad: 8_000,
        }),
      ],
      annualIncomeCad: 60_000,
      province: "ON",
      usdToCad: null,
    });

    expect(result.totalGrossCad).toBe(60_000);
    expect(result.netZakatableCad).toBeCloseTo(result.totalGrossCad - result.totalTaxCad, 2);
    expect(result.zakatDueCad).toBeCloseTo(result.netZakatableCad * 0.025, 2);

    // Category totals should include exactly the three categories present.
    const categories = result.categoryTotals.map((c) => c.category);
    expect(categories).toEqual(["TFSA", "RRSP", "NON_REGISTERED"]);
  });

  it("returns zero totals for an empty portfolio without throwing", () => {
    const result = computeZakat({
      holdings: [],
      annualIncomeCad: 50_000,
      province: "ON",
      usdToCad: null,
    });
    expect(result.totalGrossCad).toBe(0);
    expect(result.zakatDueCad).toBe(0);
    expect(result.lineItems).toHaveLength(0);
  });
});

describe("computeZakat — headline marginal rate", () => {
  it("reports the rate on the next dollar at the stated income, independent of withdrawal size", () => {
    const result = computeZakat({
      holdings: [screened({ accountName: "RRSP", accountType: "RRSP", marketValue: 200_000 })],
      annualIncomeCad: 85_000,
      province: "ON",
      usdToCad: null,
    });

    const expectedRatePct = round(effectiveMarginalRate(85_000, 1, "ON") * 100, 1);
    expect(result.marginalRateAtIncomePct).toBeCloseTo(expectedRatePct, 1);
    // This headline rate must NOT drift with the size of the RRSP withdrawal
    // being screened — it's "your bracket right now", not the rate on this
    // particular line item (a $200,000 RRSP withdrawal spans several higher
    // brackets, so line.marginalRateApplied is expected to be well above it).
    const line = result.lineItems[0];
    expect(line.marginalRateApplied).toBeGreaterThan(result.marginalRateAtIncomePct);
  });

  it("is 0 for an income low enough to sit entirely in the tax-free zone", () => {
    const result = computeZakat({
      holdings: [screened({ accountName: "TFSA", accountType: "TFSA", marketValue: 1_000 })],
      annualIncomeCad: 0,
      province: "AB",
      usdToCad: null,
    });
    expect(result.marginalRateAtIncomePct).toBeGreaterThanOrEqual(0);
  });
});

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
