/**
 * Integration tests for the scan pipeline.
 *
 * These hit the live screener, so they are slower than the unit tests but they
 * are the only place the whole chain (CSV -> route -> resolve -> fetch ->
 * purify -> summarize) is exercised together.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseWealthsimpleCsv } from "@/lib/holdings/csv";
import { scanHoldings, type ScanOutput } from "@/lib/scan";
import { groupHoldings } from "@/lib/group";

const csv = readFileSync(join(process.cwd(), "data", "fixtures", "sample-holdings.csv"), "utf8");
const USD_CAD = 1.4; // fixed so assertions do not depend on live FX

let scan: ScanOutput;

beforeAll(async () => {
  const { holdings } = parseWealthsimpleCsv(csv);
  scan = await scanHoldings(holdings, { SPUS: 120, MSFT: 30 }, USD_CAD);
}, 60_000);

const bySymbol = (s: string) => scan.holdings.find((h) => h.holding.symbol === s)!;

describe("routing and verdicts", () => {
  it("resolves ABX to Barrick and marks it compliant", () => {
    const abx = bySymbol("ABX");
    expect(abx.status).toBe("COMPLIANT");
    expect(abx.screen?.companyName).toMatch(/Barrick/i);
  });

  it("resolves CCO to Cameco, not Clear Channel Outdoor", () => {
    const cco = bySymbol("CCO");
    expect(cco.screen?.companyName).toMatch(/Cameco/i);
    expect(cco.status).toBe("COMPLIANT");
  });

  it("flags JPMorgan as non-compliant with the offending activity", () => {
    const jpm = bySymbol("JPM");
    expect(jpm.status).toBe("NOT_COMPLIANT");
    expect(jpm.screen?.nonComplianceReason).toBe("Banks (NEC)");
  });

  it("leaves a CSE listing unresolved rather than guessing", () => {
    expect(bySymbol("PHOS").status).toBe("UNRESOLVED");
  });

  it("marks an unrecognized ETF for review rather than assuming compliance", () => {
    expect(bySymbol("ZZQQ").status).toBe("NEEDS_REVIEW");
  });

  it("does not screen cash, crypto or metal", () => {
    for (const s of ["CAD", "BTC", "GOLD"]) {
      expect(bySymbol(s).status).toBe("NOT_SCREENABLE");
    }
    expect(bySymbol("BTC").explanation).toMatch(/divided/i);
  });
});

describe("purification", () => {
  it("computes AAOIFI purification per position", () => {
    // JPM: 5 shares x $12.141 published per-share figure.
    expect(bySymbol("JPM").purification.aaoifiUsd).toBeCloseTo(60.71, 2);
  });

  it("computes dividend-based purification for funds", () => {
    // SPUS Q1 2026 rate is 1.81% of dividends received.
    expect(bySymbol("SPUS").purification.dividendBasedUsd).toBeCloseTo(2.17, 2);
  });

  it("returns zero for sukuk rather than null", () => {
    expect(bySymbol("SPSK").purification.dividendBasedUsd).toBe(0);
  });
});

describe("currency normalization in portfolio totals", () => {
  it("normalizes USD positions to CAD before aggregating", () => {
    // Compliant, CAD: ABX 5837.50 + AEM 2602.90 + CCO 2657.40 + WSHR 7084
    //                 + ABX.TO 2615.20 + WSHR 24478.05
    // Compliant, USD: MSFT 4820.10 + SPUS 5861.50 + SPSK 894.75 + SPUS 12964.09
    // Non-compliant:  JPM 1808.95 (USD)
    const compliantCad =
      5837.5 + 2602.9 + 2657.4 + 7084 + 2615.2 + 24478.05 +
      (4820.1 + 5861.5 + 894.75 + 12964.09) * USD_CAD;
    const nonCompliantCad = 1808.95 * USD_CAD;
    const expected =
      Math.round((compliantCad / (compliantCad + nonCompliantCad)) * 1000) / 10;

    expect(scan.summary.compliantPctByValue).toBeCloseTo(expected, 1);
    expect(scan.summary.valuesFxNormalized).toBe(true);
  });

  it("reports unverified value in CAD without double-converting", () => {
    // PHOS is already CAD (696); ZZQQ is USD (1000) and converts once.
    expect(scan.summary.unverifiedValueCad).toBeCloseTo(696 + 1000 * USD_CAD, 1);
  });

  it("flags when no FX rate was available instead of implying precision", async () => {
    const { holdings } = parseWealthsimpleCsv(csv);
    const noFx = await scanHoldings(holdings, {}, null);
    expect(noFx.summary.valuesFxNormalized).toBe(false);
    expect(noFx.warnings.join(" ")).toMatch(/mix currencies at face value/i);
  }, 60_000);
});

describe("portfolio totals", () => {
  it("counts every position, including cash and crypto", () => {
    expect(scan.summary.totalPositions).toBe(16);
  });

  it("counts distinct assets the same way the table groups them", () => {
    // 16 positions, but ABX/ABX.TO, SPUS x2 and WSHR x2 each consolidate.
    // A mismatch here would show "16 assets" above a 13-row table.
    expect(scan.summary.distinctAssets).toBe(13);
    expect(groupHoldings(scan.holdings)).toHaveLength(13);
  });

  it("splits invested from cash", () => {
    // The only CURRENCY row in the sample is 100.00 CAD.
    expect(scan.summary.cashValueCad).toBeCloseTo(100, 2);
    expect(scan.summary.investedValueCad + scan.summary.cashValueCad).toBeCloseTo(
      scan.summary.totalPortfolioValueCad,
      2,
    );
  });

  it("totals more than the screenable slice, since cash and crypto count", () => {
    expect(scan.summary.totalPortfolioValueCad).toBeGreaterThan(scan.summary.investedValueCad - 1);
    // BTC (8989.33) and gold (6060.38) are in the total but not screened.
    expect(scan.summary.totalPortfolioValueCad).toBeGreaterThan(50000);
  });

  it("breaks value down by account", () => {
    const names = scan.summary.accounts.map((a) => a.name).sort();
    expect(names).toEqual(["Crypto", "Non-registered", "RRSP", "TFSA"]);
    const summed = scan.summary.accounts.reduce((s, a) => s + a.valueCad, 0);
    expect(summed).toBeCloseTo(scan.summary.totalPortfolioValueCad, 1);
  });
});

describe("standards count reaches the UI layer", () => {
  it("is populated for resolved compliant stocks", () => {
    const msft = bySymbol("MSFT");
    expect(msft.screen?.standardsTotal).toBe(5);
    expect(msft.screen?.standardsPassed).toBeGreaterThan(0);
  });

  it("carries a source URL for the full breakdown", () => {
    expect(bySymbol("MSFT").screen?.sourceUrl).toMatch(/^https:\/\/spscreener\./);
  });
});

describe("provenance", () => {
  it("surfaces the source data date so staleness is visible", () => {
    expect(scan.sourceUpdatedOn).toBeTruthy();
  });
});
