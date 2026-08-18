/**
 * Tests for the SnapTrade normalization layer.
 *
 * The network calls need live credentials and are not covered here, but the
 * mapping from SnapTrade's payload into our Holding shape is pure and is
 * exactly where a silent bug would do damage — misclassifying an ETF sends it
 * to the stock screener, which has no ETF coverage, and it comes back
 * "unresolved" for no good reason.
 */
import { describe, it, expect } from "vitest";
import { toSecurityType, positionToHolding, isConfigured } from "@/lib/holdings/snaptrade";

describe("toSecurityType", () => {
  it("recognizes funds", () => {
    expect(toSecurityType("Exchange Traded Fund")).toBe("EXCHANGE_TRADED_FUND");
    expect(toSecurityType("ETF")).toBe("EXCHANGE_TRADED_FUND");
    expect(toSecurityType("Mutual Fund")).toBe("EXCHANGE_TRADED_FUND");
  });

  it("recognizes non-equity asset classes", () => {
    expect(toSecurityType("Cryptocurrency")).toBe("CRYPTOCURRENCY");
    expect(toSecurityType("Cash")).toBe("CURRENCY");
    expect(toSecurityType("Precious Metal")).toBe("PRECIOUS_METAL");
  });

  it("checks crypto before fund so 'crypto fund' is not miscategorized", () => {
    expect(toSecurityType("Crypto Fund")).toBe("CRYPTOCURRENCY");
  });

  it("defaults to equity for anything unrecognized", () => {
    expect(toSecurityType("Common Stock")).toBe("EQUITY");
    expect(toSecurityType(undefined)).toBe("EQUITY");
    expect(toSecurityType(null)).toBe("EQUITY");
  });
});

describe("positionToHolding", () => {
  const position = {
    units: 100,
    price: 58.375,
    symbol: {
      symbol: {
        symbol: "ABX",
        description: "Barrick Mining Corp.",
        type: { description: "Common Stock" },
        currency: { code: "CAD" },
        exchange: { mic_code: "XTSE", code: "TSX" },
      },
    },
  };

  it("maps a position into our Holding shape", () => {
    const h = positionToHolding(position, "TFSA", "TFSA")!;
    expect(h.symbol).toBe("ABX");
    expect(h.name).toBe("Barrick Mining Corp.");
    expect(h.securityType).toBe("EQUITY");
    expect(h.quantity).toBe(100);
    expect(h.marketValue).toBeCloseTo(5837.5, 2);
    expect(h.accountName).toBe("TFSA");
  });

  it("carries the MIC through, since resolution depends on it", () => {
    // Without XTSE, ABX could resolve to Abacus Global Management on NYSE,
    // which has the opposite compliance verdict.
    expect(positionToHolding(position, "TFSA", "TFSA")!.mic).toBe("XTSE");
  });

  it("marks negative quantities as short rather than silently netting", () => {
    const h = positionToHolding({ ...position, units: -50 }, "Margin", "MARGIN")!;
    expect(h.direction).toBe("SHORT");
    expect(h.quantity).toBe(-50);
  });

  it("tolerates a flattened symbol object", () => {
    const flat = {
      units: 5,
      price: 10,
      symbol: { symbol: "MSFT", description: "Microsoft", currency: { code: "USD" } },
    };
    const h = positionToHolding(flat, "RRSP", "RRSP")!;
    expect(h.symbol).toBe("MSFT");
    expect(h.marketValueCurrency).toBe("USD");
  });

  it("returns null for a position with no symbol rather than a junk row", () => {
    expect(positionToHolding({ units: 1, price: 1, symbol: {} }, "A", "A")).toBeNull();
  });

  it("does not throw on missing numeric fields", () => {
    const h = positionToHolding({ symbol: { symbol: { symbol: "X" } } }, "A", "A")!;
    expect(h.quantity).toBe(0);
    expect(h.marketValue).toBe(0);
  });
});

describe("isConfigured", () => {
  it("is false without credentials, so the CSV path stays the default", () => {
    delete process.env.SNAPTRADE_CLIENT_ID;
    delete process.env.SNAPTRADE_CONSUMER_KEY;
    expect(isConfigured()).toBe(false);
  });
});
