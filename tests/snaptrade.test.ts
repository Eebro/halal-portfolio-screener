/**
 * Tests for the SnapTrade normalization layer.
 *
 * The network calls need live credentials and are not covered here, but the
 * mapping from SnapTrade's payload into our Holding shape is pure and is
 * exactly where a silent bug would do damage — misclassifying an ETF sends it
 * to the stock screener, which has no ETF coverage, and it comes back
 * "unresolved" for no good reason.
 *
 * Fixture shapes here are taken directly from the installed SDK's generated
 * type definitions (node_modules/snaptrade-typescript-sdk, v12.1.3), not
 * guessed. An earlier version of this test suite used a fabricated shape
 * (nested `symbol.symbol.symbol`, numeric `units`/`price`, `exchange` as an
 * object with `.mic_code`) that does not match any real SnapTrade response —
 * every one of those tests passed while the actual integration silently
 * returned zero holdings for any real account, since:
 *   - `units`/`price` are STRINGS on the wire ("58.375"), not numbers
 *   - the field is `position.instrument`, not `position.symbol.symbol`
 *   - `instrument.exchange` is a bare string, not an object
 *   - the real position-fetch method is `getAllAccountPositions`, which
 *     returns `{ results: [...] }`, not `getUserAccountPositions` (which
 *     does not exist on this SDK version) returning a bare array
 *
 * The GOLD/BTC fixtures below are taken verbatim from a real connected
 * Wealthsimple account (values redacted/rounded), not synthesized — this is
 * what caught SnapTrade classifying physically-backed gold as `kind: "other"`
 * rather than any precious-metal-specific tag.
 */
import { describe, it, expect } from "vitest";
import { toSecurityType, positionToHolding, isConfigured } from "@/lib/holdings/snaptrade";

describe("toSecurityType", () => {
  it("maps SnapTrade's closed instrument-kind enum", () => {
    // `kind` is a discriminated-union tag, not free text — an exact match,
    // not a heuristic guess the way an earlier version worked.
    expect(toSecurityType("stock")).toBe("EQUITY");
    expect(toSecurityType("etf")).toBe("EXCHANGE_TRADED_FUND");
    expect(toSecurityType("mutualfund")).toBe("EXCHANGE_TRADED_FUND");
    expect(toSecurityType("crypto")).toBe("CRYPTOCURRENCY");
  });

  it("maps every other instrument kind to equity rather than guessing", () => {
    for (const kind of ["adr", "cef", "cfd", "future", "option", "other"]) {
      expect(toSecurityType(kind)).toBe("EQUITY");
    }
  });

  it("defaults to equity for an unrecognized or missing kind", () => {
    expect(toSecurityType("something_new")).toBe("EQUITY");
    expect(toSecurityType(undefined)).toBe("EQUITY");
    expect(toSecurityType(null)).toBe("EQUITY");
  });

  it("recognizes physically-backed gold via its exchange code, not kind", () => {
    // Confirmed against a real account: SnapTrade reports Wealthsimple's
    // physical gold as kind "other" (its catch-all bucket) — kind alone is
    // ambiguous here, since "other" also covers genuinely unclassifiable
    // instruments. The exchange string is the only reliable signal.
    expect(toSecurityType("other", "WST-PRECIOUS-METAL")).toBe("PRECIOUS_METAL");
  });

  it("does not misclassify an ordinary 'other' instrument as precious metal", () => {
    expect(toSecurityType("other", "XNAS")).toBe("EQUITY");
    expect(toSecurityType("other")).toBe("EQUITY");
  });
});

describe("positionToHolding", () => {
  // Shape verified against AccountPosition + StockInstrument in the SDK's
  // generated .d.ts: units/price are strings, instrument fields are flat.
  const position = {
    units: "100",
    price: "58.375",
    currency: "CAD",
    instrument: {
      kind: "stock",
      id: "abc-123",
      symbol: "ABX",
      raw_symbol: "ABX",
      description: "Barrick Mining Corp.",
      currency: "CAD",
      exchange: "XTSE",
    },
  };

  it("maps a real-shaped position into our Holding shape", () => {
    const h = positionToHolding(position, "TFSA", "TFSA")!;
    expect(h.symbol).toBe("ABX");
    expect(h.name).toBe("Barrick Mining Corp.");
    expect(h.securityType).toBe("EQUITY");
    expect(h.quantity).toBe(100);
    expect(h.marketValue).toBeCloseTo(5837.5, 2);
    expect(h.accountName).toBe("TFSA");
  });

  it("parses string units and price into numbers", () => {
    // This is the single most important behaviour here: SnapTrade sends
    // "100" and "58.375" as strings. A naive `typeof v === "number"` guard
    // (what an earlier version used) silently produces 0 for every position.
    const h = positionToHolding(position, "TFSA", "TFSA")!;
    expect(h.quantity).toBe(100);
    expect(h.marketPrice).toBe(58.375);
  });

  it("carries the exchange through as a bare string, since resolution depends on it", () => {
    // Without XTSE, ABX could resolve to Abacus Global Management on NYSE,
    // which has the opposite compliance verdict. SnapTrade's `exchange`
    // field is a plain string, not an object with a `.mic_code`.
    expect(positionToHolding(position, "TFSA", "TFSA")!.mic).toBe("XTSE");
  });

  it("marks negative quantities as short rather than silently netting", () => {
    const h = positionToHolding({ ...position, units: "-50" }, "Margin", "MARGIN")!;
    expect(h.direction).toBe("SHORT");
    expect(h.quantity).toBe(-50);
  });

  it("classifies an ETF instrument correctly", () => {
    const etfPosition = {
      units: "10",
      price: "35.42",
      instrument: {
        kind: "etf",
        symbol: "WSHR",
        raw_symbol: "WSHR",
        description: "Wealthsimple Shariah World Equity Index ETF",
        currency: "CAD",
        exchange: "NEOE",
      },
    };
    const h = positionToHolding(etfPosition, "TFSA", "TFSA")!;
    expect(h.securityType).toBe("EXCHANGE_TRADED_FUND");
  });

  it("classifies a real physically-backed gold position from a live account", () => {
    // Taken verbatim (values rounded) from a real connected Wealthsimple
    // account. Confirms toSecurityType's exchange-based special case is
    // actually wired up in positionToHolding, not just tested in isolation.
    const goldPosition = {
      units: "1.0809182736",
      price: "6205.345",
      currency: "CAD",
      instrument: {
        kind: "other",
        symbol: "GOLD",
        raw_symbol: "GOLD",
        description: "Physically-backed gold",
        currency: "CAD",
        exchange: "WST-PRECIOUS-METAL",
      },
    };
    const h = positionToHolding(goldPosition, "Personal", "PERSONAL")!;
    expect(h.securityType).toBe("PRECIOUS_METAL");
    expect(h.symbol).toBe("GOLD");
  });

  it("classifies a real crypto position from a live account", () => {
    const btcPosition = {
      units: "0.1093494403",
      price: "94170.4098448",
      currency: "CAD",
      instrument: {
        kind: "crypto",
        symbol: "BTC",
        raw_symbol: "BTC",
        description: "Bitcoin",
        currency: "USD",
        exchange: "WST-CRYPTO",
      },
    };
    const h = positionToHolding(btcPosition, "Crypto", "CRYPTO")!;
    expect(h.securityType).toBe("CRYPTOCURRENCY");
  });

  it("returns null for a position with no symbol rather than a junk row", () => {
    expect(positionToHolding({ units: "1", price: "1", instrument: {} }, "A", "A")).toBeNull();
  });

  it("falls back to raw_symbol when symbol is absent", () => {
    const h = positionToHolding(
      { units: "1", price: "1", instrument: { raw_symbol: "MSFT", currency: "USD" } },
      "RRSP",
      "RRSP",
    )!;
    expect(h.symbol).toBe("MSFT");
    expect(h.marketValueCurrency).toBe("USD");
  });

  it("does not throw on missing numeric fields", () => {
    const h = positionToHolding({ instrument: { symbol: "X" } }, "A", "A")!;
    expect(h.quantity).toBe(0);
    expect(h.marketValue).toBe(0);
  });

  it("does not throw on malformed non-numeric strings", () => {
    const h = positionToHolding(
      { units: "not-a-number", price: "also-bad", instrument: { symbol: "X" } },
      "A",
      "A",
    )!;
    expect(h.quantity).toBe(0);
    expect(h.marketPrice).toBe(0);
  });
});

describe("isConfigured", () => {
  it("is false without credentials, so the CSV path stays the default", () => {
    delete process.env.SNAPTRADE_CLIENT_ID;
    delete process.env.SNAPTRADE_CONSUMER_KEY;
    expect(isConfigured()).toBe(false);
  });
});
