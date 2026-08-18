import { describe, it, expect } from "vitest";
import { computePurification, totalPurification, zakatOnTradingValue } from "@/lib/purification";
import type { EtfEntry, Holding, ScreenResult } from "@/lib/types";

const holding = (over: Partial<Holding> = {}): Holding => ({
  symbol: "AAPL",
  name: "Apple Inc.",
  securityType: "EQUITY",
  mic: "XNAS",
  exchange: "NASDAQ",
  quantity: 100,
  direction: "LONG",
  marketPrice: 200,
  marketPriceCurrency: "USD",
  marketValue: 20000,
  marketValueCurrency: "USD",
  bookValueCad: 25000,
  accountName: "RRSP",
  accountType: "RRSP",
  ...over,
});

const screen = (over: Partial<ScreenResult> = {}): ScreenResult => ({
  ticker: "AAPL",
  companyName: "Apple Inc",
  status: "COMPLIANT",
  summary: "Apple Inc is Shariah Compliant.",
  nonComplianceReason: null,
  standardsPassed: 5,
  standardsTotal: 5,
  impureIncomePct: 3.14,
  purificationPerShareUsd: 0.236,
  zakatPerShareUsd: 0.145,
  ratios: [],
  impureIncomeBreakdown: [],
  exchange: "NASDAQ",
  sector: "Technology",
  updatedOn: "July 21, 2026",
  sourceUrl: "x",
  ...over,
});

describe("AAOIFI per-share purification", () => {
  it("multiplies the published per-share figure by quantity", () => {
    const p = computePurification({ holding: holding({ quantity: 100 }), screen: screen() });
    expect(p.aaoifiUsd).toBe(23.6);
  });

  it("does not annualize the published period figure", () => {
    // The source publishes one financial period's amount. Multiplying by four
    // would be our invention, not their guidance.
    const p = computePurification({ holding: holding({ quantity: 1 }), screen: screen() });
    expect(p.aaoifiUsd).toBe(0.24);
  });

  it("computes zakat on the long-term per-share basis", () => {
    const p = computePurification({ holding: holding({ quantity: 100 }), screen: screen() });
    expect(p.zakatUsd).toBe(14.5);
  });

  it("uses absolute quantity so a short position does not net out", () => {
    const p = computePurification({
      holding: holding({ quantity: -100, direction: "SHORT" }),
      screen: screen(),
    });
    expect(p.aaoifiUsd).toBe(23.6);
    expect(p.notes.join(" ")).toMatch(/SHORT/);
  });
});

describe("dividend-based purification", () => {
  it("applies the impure income percentage to dividends received", () => {
    const p = computePurification({
      holding: holding(),
      screen: screen(),
      dividendsReceivedUsd: 100,
    });
    expect(p.dividendBasedUsd).toBe(3.14);
  });

  it("stays null — not zero — when dividends are unknown", () => {
    // Zero would read as "nothing owed"; null means "we cannot say yet".
    const p = computePurification({ holding: holding(), screen: screen() });
    expect(p.dividendBasedUsd).toBeNull();
    expect(p.notes.join(" ")).toMatch(/enter your dividends/i);
  });

  it("stays null when the source publishes no impure income figure", () => {
    const p = computePurification({
      holding: holding(),
      screen: screen({ impureIncomePct: null }),
      dividendsReceivedUsd: 500,
    });
    expect(p.dividendBasedUsd).toBeNull();
  });
});

describe("non-compliant holdings", () => {
  it("still reports purification while leaving impure income null", () => {
    const jpm = screen({
      status: "NOT_COMPLIANT",
      impureIncomePct: null,
      purificationPerShareUsd: 12.141,
      zakatPerShareUsd: null,
    });
    const p = computePurification({ holding: holding({ quantity: 5 }), screen: jpm });
    expect(p.aaoifiUsd).toBe(60.71);
    expect(p.dividendBasedUsd).toBeNull();
    expect(p.zakatUsd).toBeNull();
  });
});

describe("ETFs", () => {
  const etf = (over: Partial<EtfEntry> = {}): EtfEntry => ({
    ticker: "SPUS",
    name: "SP Funds S&P 500 Sharia Industry Exclusions ETF",
    provider: "SP Funds",
    shariahCompliant: true,
    purificationRatePct: 1.81,
    ratePeriod: "Q1 2026",
    note: null,
    sourceUrl: "x",
    ...over,
  });

  it("purifies on dividends at the published quarterly rate", () => {
    const p = computePurification({
      holding: holding({ symbol: "SPUS", securityType: "EXCHANGE_TRADED_FUND" }),
      etf: etf(),
      dividendsReceivedUsd: 120,
    });
    expect(p.dividendBasedUsd).toBe(2.17);
    // Funds have no per-share AAOIFI figure — null is correct, not a gap.
    expect(p.aaoifiUsd).toBeNull();
  });

  it("returns zero for sukuk funds, which need no purification", () => {
    const p = computePurification({
      holding: holding({ symbol: "SPSK", securityType: "EXCHANGE_TRADED_FUND" }),
      etf: etf({ ticker: "SPSK", purificationRatePct: 0, note: "Sukuk are compliant by definition." }),
      dividendsReceivedUsd: 500,
    });
    expect(p.dividendBasedUsd).toBe(0);
  });

  it("says so when no rate is published rather than assuming zero", () => {
    const p = computePurification({
      holding: holding({ symbol: "WSHR", securityType: "EXCHANGE_TRADED_FUND" }),
      etf: etf({ ticker: "WSHR", purificationRatePct: null, provider: "Wealthsimple" }),
      dividendsReceivedUsd: 300,
    });
    expect(p.dividendBasedUsd).toBeNull();
    expect(p.notes.join(" ")).toMatch(/No published purification rate/i);
  });
});

describe("totals", () => {
  it("skips nulls and counts positions it could not compute", () => {
    const totals = totalPurification([
      { aaoifiUsd: 10, dividendBasedUsd: 2, zakatUsd: 1, notes: [] },
      { aaoifiUsd: null, dividendBasedUsd: null, zakatUsd: null, notes: [] },
      { aaoifiUsd: 5.5, dividendBasedUsd: null, zakatUsd: 0.5, notes: [] },
    ]);
    expect(totals.aaoifiUsd).toBe(15.5);
    expect(totals.dividendBasedUsd).toBe(2);
    expect(totals.zakatUsd).toBe(1.5);
    expect(totals.incompleteCount).toBe(1);
  });
});

describe("zakat on trading-intent holdings", () => {
  it("is 2.5% of market value", () => {
    expect(zakatOnTradingValue(10000)).toBe(250);
  });
});
