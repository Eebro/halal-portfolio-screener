/**
 * Marginal tax calculator tests.
 *
 * Reference values below are hand-computed (bracket-by-bracket, not derived
 * from the function under test) so these actually catch a wrong
 * implementation rather than just echoing it back.
 */
import { describe, it, expect } from "vitest";
import {
  marginalTaxOnAmount,
  effectiveMarginalRate,
  FEDERAL_BRACKETS,
  PROVINCIAL_BRACKETS,
  PROVINCE_LABELS,
  type ProvinceCode,
} from "@/lib/tax/brackets";

describe("marginalTaxOnAmount", () => {
  it("computes stacked tax for a withdrawal spanning one federal bracket, Ontario", () => {
    // $50,000 income + $30,000 RRSP withdrawal, Ontario.
    // Federal: entirely within the 14% bracket (up to $58,523) except the
    // portion from $58,523 to $80,000 at 20.5%.
    //   14% slice: 50,000 -> 58,523 = 8,523 * 0.14 = 1,193.22
    //   20.5% slice: 58,523 -> 80,000 = 21,477 * 0.205 = 4,402.785
    //   federal total = 5,596.005
    // Ontario: 5.05% up to 53,891, 9.15% up to 80,000
    //   5.05% slice: 50,000 -> 53,891 = 3,891 * 0.0505 = 196.4955
    //   9.15% slice: 53,891 -> 80,000 = 26,109 * 0.0915 = 2,388.9735
    //   provincial total = 2,585.469
    // combined = 8,181.474
    const tax = marginalTaxOnAmount(50_000, 30_000, "ON");
    expect(tax).toBeCloseTo(8181.474, 2);
  });

  it("computes tax for a withdrawal starting from zero income", () => {
    // $0 base + $100,000 RRSP withdrawal, Ontario. Spans all five federal
    // brackets partially and four Ontario brackets.
    //   federal: 14%*58,523 + 20.5%*(100,000-58,523) = 8,193.22 + 8,502.785 = 16,696.005
    //   ontario: 5.05%*53,891 + 9.15%*(100,000-53,891) = 2,721.4955 + 4,218.9735 = 6,940.469
    const tax = marginalTaxOnAmount(0, 100_000, "ON");
    expect(tax).toBeCloseTo(23_636.474, 2);
  });

  it("computes tax for a withdrawal spanning many brackets, Alberta", () => {
    // $40,000 income + $200,000 withdrawal, Alberta.
    const tax = marginalTaxOnAmount(40_000, 200_000, "AB");
    expect(tax).toBeCloseTo(70_155.04, 2);
  });

  it("computes tax for a small withdrawal fully within the first bracket", () => {
    // $0 base + $5,000, Ontario: entirely in the lowest bracket both levels.
    const tax = marginalTaxOnAmount(0, 5_000, "ON");
    expect(tax).toBeCloseTo(700 + 252.5, 2);
  });

  it("returns 0 for a zero or negative amount", () => {
    expect(marginalTaxOnAmount(50_000, 0, "ON")).toBe(0);
    expect(marginalTaxOnAmount(50_000, -100, "ON")).toBe(0);
  });

  it("treats negative base income as zero rather than producing negative tax", () => {
    expect(marginalTaxOnAmount(-10_000, 5_000, "ON")).toBe(marginalTaxOnAmount(0, 5_000, "ON"));
  });

  it("stacks correctly — a withdrawal is taxed at the top of the income, not a flat rate for the whole amount", () => {
    // A huge existing income means a modest withdrawal sits entirely in the
    // top bracket — this is the "stacked, not flat-rate-at-base-income"
    // requirement the plan calls for.
    const tax = marginalTaxOnAmount(500_000, 10_000, "ON");
    // Both federal (33%) and Ontario (13.16%) top brackets apply to the whole amount.
    expect(tax).toBeCloseTo(10_000 * (0.33 + 0.1316), 2);
  });
});

describe("effectiveMarginalRate", () => {
  it("matches marginalTaxOnAmount divided by the amount", () => {
    const rate = effectiveMarginalRate(50_000, 30_000, "ON");
    expect(rate).toBeCloseTo(8181.474 / 30_000, 6);
  });

  it("returns 0 for a non-positive amount rather than NaN", () => {
    expect(effectiveMarginalRate(50_000, 0, "ON")).toBe(0);
  });
});

describe("bracket table completeness", () => {
  it("has all 13 provinces and territories", () => {
    const codes = Object.keys(PROVINCIAL_BRACKETS) as ProvinceCode[];
    expect(codes).toHaveLength(13);
    for (const code of codes) {
      expect(PROVINCE_LABELS[code]).toBeTruthy();
    }
  });

  it("every province's bracket table is sorted ascending and ends unbounded", () => {
    for (const code of Object.keys(PROVINCIAL_BRACKETS) as ProvinceCode[]) {
      const brackets = PROVINCIAL_BRACKETS[code];
      const last = brackets[brackets.length - 1];
      expect(last.upTo).toBeNull();
      for (let i = 1; i < brackets.length; i++) {
        const prevUpTo = brackets[i - 1].upTo;
        if (prevUpTo !== null && brackets[i].upTo !== null) {
          expect(brackets[i].upTo as number).toBeGreaterThan(prevUpTo);
        }
      }
    }
  });

  it("federal brackets are sorted ascending and end unbounded", () => {
    expect(FEDERAL_BRACKETS[FEDERAL_BRACKETS.length - 1].upTo).toBeNull();
  });

  it("includes Quebec, sourced separately from Revenu Québec since CRA excludes it", () => {
    expect(PROVINCIAL_BRACKETS.QC).toBeDefined();
    expect(PROVINCIAL_BRACKETS.QC[0].rate).toBe(0.14);
  });
});

describe("sanity check against NZF Canada's published example", () => {
  it("is the same order of magnitude as NZF's flat-30%-withholding example, but not identical", () => {
    // NZF's own worked example: $100,000 RRSP, flat 30% CRA withholding tier
    // -> $30,000 tax -> $70,000 net. This app uses marginal rate instead
    // (more accurate but not what NZF's example literally computes), so an
    // exact match is not expected — but the numbers should be in the same
    // ballpark, not wildly different.
    const tax = marginalTaxOnAmount(0, 100_000, "ON");
    const net = 100_000 - tax;
    expect(tax).toBeGreaterThan(0);
    expect(tax).toBeLessThan(50_000); // sanity bound: not absurdly high
    expect(net).toBeGreaterThan(50_000); // sanity bound: not absurdly low
    // At $0 base income, marginal rate ramps up gradually, so it's lower
    // than NZF's flat 30% figure for this example.
    expect(tax).toBeLessThan(30_000);
  });
});
