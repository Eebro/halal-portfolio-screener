import { describe, it, expect } from "vitest";
import { groupHoldings } from "@/lib/group";
import type { Holding, ScreenedHolding } from "@/lib/types";

const holding = (over: Partial<Holding>): Holding => ({
  symbol: "WSHR",
  name: "Wealthsimple Shariah World Equity Index ETF",
  securityType: "EXCHANGE_TRADED_FUND",
  mic: "NEOE",
  exchange: "CBOE CANADA",
  quantity: 100,
  direction: "LONG",
  marketPrice: 35.42,
  marketPriceCurrency: "CAD",
  marketValue: 3542,
  marketValueCurrency: "CAD",
  bookValueCad: 3400,
  accountName: "TFSA",
  accountType: "TFSA",
  ...over,
});

const screened = (h: Holding, over: Partial<ScreenedHolding> = {}): ScreenedHolding => ({
  holding: h,
  route: "etf",
  status: "COMPLIANT",
  screen: null,
  etf: null,
  purification: { aaoifiUsd: null, dividendBasedUsd: null, zakatUsd: null, notes: [] },
  explanation: "",
  ...over,
});

describe("grouping the same asset across accounts", () => {
  const items = [
    screened(holding({ accountName: "TFSA", quantity: 691, marketValue: 24478 })),
    screened(holding({ accountName: "FHSA", quantity: 421, marketValue: 14929 })),
    screened(holding({ accountName: "Non-registered", quantity: 207, marketValue: 7348 })),
  ];

  it("consolidates into one row", () => {
    const groups = groupHoldings(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].symbol).toBe("WSHR");
  });

  it("sums quantity and market value", () => {
    const g = groupHoldings(items)[0];
    expect(g.totalQuantity).toBe(1319);
    expect(g.totalMarketValue).toBe(46755);
  });

  it("keeps the per-account split, largest first", () => {
    const g = groupHoldings(items)[0];
    expect(g.accounts.map((a) => a.accountName)).toEqual(["TFSA", "FHSA", "Non-registered"]);
    expect(g.accounts[0].marketValue).toBe(24478);
  });
});

describe("grouping across inconsistent ticker suffixes", () => {
  it("merges ABX and ABX.TO for the same company", () => {
    const groups = groupHoldings([
      screened(holding({ symbol: "ABX", name: "Barrick Mining Corp.", quantity: 34 })),
      screened(holding({ symbol: "ABX.TO", name: "Barrick Mining Corp.", quantity: 44 })),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].totalQuantity).toBe(78);
  });

  it("does NOT merge different companies that share a ticker", () => {
    // Barrick and Abacus Global both trade as ABX. Merging them would sum
    // positions of unrelated companies into one bogus row.
    const groups = groupHoldings([
      screened(holding({ symbol: "ABX", name: "Barrick Mining Corp." })),
      screened(holding({ symbol: "ABX", name: "Abacus Global Management Inc" })),
    ]);
    expect(groups).toHaveLength(2);
  });
});

describe("edge cases", () => {
  it("returns null market value when one asset is held in mixed currencies", () => {
    const g = groupHoldings([
      screened(holding({ marketValue: 100, marketValueCurrency: "CAD" })),
      screened(holding({ marketValue: 100, marketValueCurrency: "USD", accountName: "RRSP" })),
    ])[0];
    // Summing CAD and USD would produce a confidently wrong number.
    expect(g.totalMarketValue).toBeNull();
    expect(g.currency).toBe("MIXED");
  });

  it("sums purification but keeps all-null as null, not zero", () => {
    const withPurification = groupHoldings([
      screened(holding({ accountName: "A" }), {
        purification: { aaoifiUsd: 10, dividendBasedUsd: null, zakatUsd: 1, notes: ["x"] },
      }),
      screened(holding({ accountName: "B" }), {
        purification: { aaoifiUsd: 5.5, dividendBasedUsd: null, zakatUsd: null, notes: ["y"] },
      }),
    ])[0];

    expect(withPurification.purificationAaoifiUsd).toBe(15.5);
    expect(withPurification.purificationDividendUsd).toBeNull();
    expect(withPurification.zakatUsd).toBe(1);
    // Notes belong to the figures actually shown, which come from the first
    // position — unioning them across positions reads as self-contradiction.
    expect(withPurification.purificationNotes).toEqual(["x"]);
  });

  it("says so when positions matched different source records", () => {
    // The screener carries near-duplicate records for some companies with
    // slightly different ratios; silently blending them would be misleading.
    const screenStub = (url: string) =>
      ({ sourceUrl: url, impureIncomePct: 0.19 }) as unknown as ScreenedHolding["screen"];

    const g = groupHoldings([
      screened(holding({ accountName: "A", symbol: "ABX", name: "Barrick Mining Corp." }), {
        route: "stock",
        screen: screenStub("https://example.test/abx-1"),
        purification: { aaoifiUsd: 1, dividendBasedUsd: null, zakatUsd: null, notes: [] },
      }),
      screened(holding({ accountName: "B", symbol: "ABX.TO", name: "Barrick Mining Corp." }), {
        route: "stock",
        screen: screenStub("https://example.test/abx-2"),
        purification: { aaoifiUsd: 1, dividendBasedUsd: null, zakatUsd: null, notes: [] },
      }),
    ])[0];

    expect(g.purificationNotes.join(" ")).toMatch(/2 separate records/i);
  });

  it("surfaces the stricter verdict and flags disagreement", () => {
    const g = groupHoldings([
      screened(holding({ accountName: "A" }), { status: "COMPLIANT" }),
      screened(holding({ accountName: "B" }), { status: "NOT_COMPLIANT" }),
    ])[0];
    expect(g.status).toBe("NOT_COMPLIANT");
    expect(g.statusConflict).toBe(true);
  });

  it("handles an empty portfolio", () => {
    expect(groupHoldings([])).toEqual([]);
  });
});
