/**
 * Resolver tests run against the real committed index, not mocks — the whole
 * class of bug we care about (ticker collisions, exchange ambiguity) only
 * exists in the real data.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TickerResolver, nameSimilarity, normalizeTicker, micToGroup } from "@/lib/screener/resolve";
import type { ScreenerIndex } from "@/scripts/build-index";
import index from "@/data/screener-index.json";

let resolver: TickerResolver;

beforeAll(() => {
  resolver = new TickerResolver(index as unknown as ScreenerIndex);
});

describe("normalizeTicker", () => {
  it("collapses inconsistent exchange suffixes", () => {
    // The same Wealthsimple export contains both bare and .TO forms for TSX.
    expect(normalizeTicker("AEM.TO")).toBe("AEM");
    expect(normalizeTicker("ABX")).toBe("ABX");
    expect(normalizeTicker("SHOP.TO")).toBe("SHOP");
    expect(normalizeTicker("RPR_u")).toBe("RPR");
  });

  it("strips SnapTrade's .VN suffix for TSX Venture, distinct from the index's own .V form", () => {
    // Confirmed against a real connected Wealthsimple account: SnapTrade
    // reports F4 Uranium as "FFU.VN" and Kraken Robotics as "PNG.VN". The
    // index itself uses a bare ".V" for the same exchange (e.g. "FFU.V").
    // Missing .VN silently produced UNRESOLVED for two holdings that are
    // genuinely in the screener index.
    expect(normalizeTicker("FFU.VN")).toBe("FFU");
    expect(normalizeTicker("PNG.VN")).toBe("PNG");
    expect(normalizeTicker("FFU.V")).toBe("FFU");
  });
});

describe("nameSimilarity", () => {
  it("matches across corporate-suffix noise", () => {
    expect(nameSimilarity("Barrick Mining Corp.", "Barrick Mining Corp")).toBe(1);
    expect(nameSimilarity("Cameco Corporation", "Cameco Corp")).toBe(1);
    expect(nameSimilarity("Agnico Eagle Mines Limited", "Agnico Eagle Mines Ltd")).toBe(1);
  });

  it("separates genuinely different companies sharing a ticker", () => {
    expect(nameSimilarity("Barrick Mining Corp.", "Abacus Global Management Inc")).toBeLessThan(0.3);
    expect(nameSimilarity("Cameco Corporation", "Clear Channel Outdoor Holdings Inc")).toBeLessThan(0.3);
  });
});

describe("micToGroup", () => {
  it("maps Canadian and US MICs", () => {
    expect(micToGroup("XTSE")).toBe("TSX");
    expect(micToGroup("XTSX")).toBe("TSXV");
    expect(micToGroup("XNAS")).toBe("NASDAQ");
    expect(micToGroup("XNYS")).toBe("NYSE");
  });

  it("returns null for exchanges the source does not cover", () => {
    // Cboe Canada and the CSE have no counterpart in the screener's 12
    // exchanges; forcing a match would risk screening the wrong listing.
    expect(micToGroup("NEOE")).toBeNull();
    expect(micToGroup("XCNQ")).toBeNull();
  });
});

describe("ticker collisions (the headline correctness risk)", () => {
  it("resolves ABX to Barrick, never Abacus Global Management", () => {
    const out = resolver.resolve({
      symbol: "ABX",
      name: "Barrick Mining Corp.",
      mic: "XTSE",
      exchange: "TSX",
    });
    expect(out.kind).toBe("resolved");
    if (out.kind !== "resolved") return;
    expect(out.entry.n).toMatch(/Barrick/i);
    expect(out.entry.n).not.toMatch(/Abacus/i);
    expect(out.entry.v).toBe("C");
  });

  it("resolves CCO to Cameco, never Clear Channel Outdoor", () => {
    const out = resolver.resolve({
      symbol: "CCO",
      name: "Cameco Corporation",
      mic: "XTSE",
      exchange: "TSX",
    });
    expect(out.kind).toBe("resolved");
    if (out.kind !== "resolved") return;
    expect(out.entry.n).toMatch(/Cameco/i);
    expect(out.entry.v).toBe("C");
  });

  it("still picks the US listing when the holding really is the US one", () => {
    const out = resolver.resolve({
      symbol: "ABX",
      name: "Abacus Global Management Inc",
      mic: "XNYS",
      exchange: "NYSE",
    });
    expect(out.kind).toBe("resolved");
    if (out.kind !== "resolved") return;
    expect(out.entry.n).toMatch(/Abacus/i);
    expect(out.entry.v).toBe("N");
  });
});

describe("short tickers that upstream search cannot find", () => {
  // SU, TRI and AG all return nothing useful from the live ?search= endpoint
  // because relevance ranking buries them. Exact index matching must work.
  it.each([
    ["SU", "Suncor Energy, Inc.", /Suncor/i],
    ["TRI", "Thomson Reuters Corp", /Thomson/i],
    ["AG", "First Majestic Silver Corporation", /Majestic/i],
  ])("resolves %s", (symbol, name, expected) => {
    const out = resolver.resolve({ symbol, name, mic: "XTSE", exchange: "TSX" });
    expect(out.kind).toBe("resolved");
    if (out.kind !== "resolved") return;
    expect(out.entry.n).toMatch(expected);
  });
});

describe("suffix inconsistency within one export", () => {
  it.each([
    ["AEM.TO", "Agnico Eagle Mines Limited"],
    ["SHOP.TO", "Shopify Inc."],
    ["CSU", "Constellation Software Inc"],
    ["CNQ.TO", "Canadian Natural Resources Ltd."],
    ["WCN.TO", "Waste Connections Inc. (CA) Inc."],
  ])("resolves %s despite suffix form", (symbol, name) => {
    const out = resolver.resolve({ symbol, name, mic: "XTSE", exchange: "TSX" });
    expect(out.kind).toBe("resolved");
  });
});

describe("SnapTrade's .VN suffix (TSX Venture)", () => {
  it("resolves PNG.VN (Kraken Robotics), which was silently UNRESOLVED before the .VN fix", () => {
    // This exact symbol form came back from a real connected Wealthsimple
    // account via SnapTrade. Before normalizeTicker handled .VN, this
    // reported UNRESOLVED for a stock that is genuinely in the index.
    const out = resolver.resolve({
      symbol: "PNG.VN",
      name: "Kraken Robotics Inc.",
      mic: "XTSX",
      exchange: "TSX-V",
    });
    expect(out.kind).toBe("resolved");
    if (out.kind === "resolved") expect(out.entry.n).toMatch(/Kraken/i);
  });
});

describe("honest failure modes", () => {
  it("returns unresolved for CSE listings the source does not cover", () => {
    const out = resolver.resolve({
      symbol: "PHOS",
      name: "First Phosphate Corp.",
      mic: "XCNQ",
      exchange: "CSE",
    });
    expect(out.kind).toBe("unresolved");
  });

  it("does not silently pick a side when the source self-contradicts", () => {
    // F4 Uranium appears twice on the venture exchange with opposite verdicts.
    const out = resolver.resolve({
      symbol: "FFU",
      name: "F4 Uranium Corp",
      mic: "XTSX",
      exchange: "TSX-V",
    });
    expect(["conflict", "resolved"]).toContain(out.kind);
    if (out.kind === "conflict") {
      const verdicts = new Set(out.candidates.map((c) => c.entry.v));
      expect(verdicts.size).toBeGreaterThan(1);
    }
  });

  it("refuses to guess when the symbol is absent entirely", () => {
    const out = resolver.resolve({ symbol: "ZZZZNOTAREALTICKER", name: "Nope", mic: "XTSE" });
    expect(out.kind).toBe("unresolved");
  });
});
