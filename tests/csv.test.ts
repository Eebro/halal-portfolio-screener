import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseWealthsimpleCsv, parseCsv } from "@/lib/holdings/csv";
import { routeHolding } from "@/lib/assetRouter";

const sample = readFileSync(
  join(process.cwd(), "data", "fixtures", "sample-holdings.csv"),
  "utf8",
);

describe("parseCsv", () => {
  it("handles quoted fields, embedded commas and escaped quotes", () => {
    const rows = parseCsv('a,"b,c","say ""hi"""\n1,2,3\n');
    expect(rows).toEqual([
      ["a", "b,c", 'say "hi"'],
      ["1", "2", "3"],
    ]);
  });

  it("handles CRLF line endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("Wealthsimple holdings export", () => {
  const result = parseWealthsimpleCsv(sample);

  it("extracts the trailing 'As of' footer rather than parsing it as a holding", () => {
    expect(result.asOf).toBe("2026-08-18 13:48 GMT-04:00");
    expect(result.holdings.some((h) => /as of/i.test(h.symbol))).toBe(false);
  });

  it("parses every holding row", () => {
    expect(result.holdings).toHaveLength(16);
  });

  it("keeps duplicate positions of one asset as separate rows", () => {
    // The parser must not consolidate — grouping is a later, testable step.
    expect(result.holdings.filter((h) => h.symbol === "WSHR")).toHaveLength(2);
    expect(result.holdings.filter((h) => h.symbol === "SPUS")).toHaveLength(2);
  });

  it("captures MIC, which is what disambiguates colliding tickers", () => {
    const abx = result.holdings.find((h) => h.symbol === "ABX")!;
    expect(abx.mic).toBe("XTSE");
    expect(abx.name).toBe("Barrick Mining Corp.");
  });

  it("preserves inconsistent ticker suffixes verbatim", () => {
    // Both are XTSE, but only one carries .TO — normalization happens later.
    expect(result.holdings.find((h) => h.symbol === "ABX")).toBeDefined();
    expect(result.holdings.find((h) => h.symbol === "AEM.TO")).toBeDefined();
  });

  it("does not retain the account number", () => {
    expect(JSON.stringify(result.holdings)).not.toContain("XXXXXXXXXX");
  });

  it("groups by account", () => {
    const accounts = new Set(result.holdings.map((h) => h.accountName));
    expect(accounts).toEqual(new Set(["Crypto", "TFSA", "RRSP", "Non-registered"]));
  });
});

describe("asset routing", () => {
  const { holdings } = parseWealthsimpleCsv(sample);
  const bySymbol = Object.fromEntries(holdings.map((h) => [h.symbol, h]));

  it.each([
    ["ABX", "stock"],
    ["MSFT", "stock"],
    ["SPUS", "etf"],
    ["WSHR", "etf"],
    ["CAD", "cash"],
    ["BTC", "informational"],
    ["GOLD", "informational"],
  ])("routes %s to %s", (symbol, expected) => {
    expect(routeHolding(bySymbol[symbol]).route).toBe(expected);
  });

  it("does not assert a verdict on crypto", () => {
    const decision = routeHolding(bySymbol["BTC"]);
    expect(decision.explanation).toMatch(/divided|consult/i);
  });
});

describe("malformed input", () => {
  it("rejects a file that is not a holdings export", () => {
    const out = parseWealthsimpleCsv("name,age\nalice,30\n");
    expect(out.holdings).toHaveLength(0);
    expect(out.warnings[0]).toMatch(/does not look like a Wealthsimple holdings export/i);
  });

  it("handles an empty file without throwing", () => {
    expect(parseWealthsimpleCsv("").holdings).toHaveLength(0);
  });

  it("warns rather than dropping an unknown security type", () => {
    const csv =
      "Account Name,Symbol,Name,Security Type,Quantity,Market Value,Market Value Currency\n" +
      '"TFSA","XYZ","Mystery Asset","WARRANT","5","100","CAD"\n';
    const out = parseWealthsimpleCsv(csv);
    expect(out.holdings).toHaveLength(1);
    expect(out.warnings.join(" ")).toMatch(/unrecognized Security Type "WARRANT"/i);
  });
});
