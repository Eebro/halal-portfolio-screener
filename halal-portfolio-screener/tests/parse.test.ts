/**
 * Golden-fixture tests for the detail-page parser.
 *
 * These run against real saved HTML. If the source site is redesigned, these
 * fail loudly — which is the point. A parser that silently returns nulls would
 * quietly under-report purification, which is worse than an obvious crash.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDetailPage, parsePct, parseMoney, textNodes } from "@/lib/screener/parse";

const fixture = (name: string) =>
  readFileSync(join(process.cwd(), "data", "fixtures", `${name}.html`), "utf8");

const parse = (name: string) => parseDetailPage(fixture(name), `fixture://${name}`);

describe("scalar parsers", () => {
  it("distinguishes absent data from zero", () => {
    // This is the single most important behaviour in the file: "-" means
    // "not applicable", and returning 0 would read as "nothing to purify".
    expect(parsePct("-")).toBeNull();
    expect(parsePct("")).toBeNull();
    expect(parsePct(undefined)).toBeNull();
    expect(parsePct("0.00%")).toBe(0);
    expect(parsePct("3.14%")).toBe(3.14);

    expect(parseMoney("-")).toBeNull();
    expect(parseMoney("$0.236")).toBe(0.236);
    expect(parseMoney("$12.141")).toBe(12.141);
  });

  it("ignores checkmarks where a percentage was expected", () => {
    expect(parsePct("✓")).toBeNull();
    expect(parsePct("✗")).toBeNull();
  });
});

describe("textNodes", () => {
  it("drops script/style and decodes entities", () => {
    const nodes = textNodes("<p>A &#8211; B</p><script>var x = '<b>no</b>';</script><i>C&amp;D</i>");
    expect(nodes).toEqual(["A - B", "C&D"]);
  });
});

describe("AAPL — compliant, full ratio set", () => {
  const r = parse("aapl");

  it("reads the header", () => {
    expect(r.ticker).toBe("AAPL");
    expect(r.companyName).toBe("Apple Inc");
    expect(r.status).toBe("COMPLIANT");
    expect(r.exchange).toBe("NASDAQ");
    expect(r.sector).toBe("Technology");
  });

  it("reads the metric cards (value precedes label)", () => {
    expect(r.impureIncomePct).toBe(3.14);
    expect(r.purificationPerShareUsd).toBe(0.236);
    expect(r.zakatPerShareUsd).toBe(0.145);
  });

  it("reads all five methodologies with their differing denominators", () => {
    expect(r.ratios.map((x) => x.methodology)).toEqual(["AAOIFI", "S&P", "DJIM", "FTSE", "MSCI"]);
    const by = Object.fromEntries(r.ratios.map((x) => [x.methodology, x]));
    // AAOIFI uses market cap, FTSE/MSCI use total assets — hence the gap.
    expect(by["AAOIFI"].debtPct).toBe(1.95);
    expect(by["AAOIFI"].nonCompliantAssetsPct).toBe(2.32);
    expect(by["S&P"].debtPct).toBe(2.54);
    expect(by["DJIM"].debtPct).toBe(2.35);
    expect(by["FTSE"].debtPct).toBe(22.83);
    expect(by["MSCI"].debtPct).toBe(22.83);
  });

  it("captures the impure income breakdown and source date", () => {
    expect(r.impureIncomeBreakdown[0].category).toMatch(/Music, Movies/i);
    expect(r.impureIncomeBreakdown[0].pct).toBe(3.14);
    expect(r.updatedOn).toBe("July 21, 2026");
  });

  it("has no non-compliance reason", () => {
    expect(r.nonComplianceReason).toBeNull();
    expect(r.summary).toMatch(/is Shariah Compliant/i);
  });

  it("reads how many standards it passes", () => {
    expect(r.standardsPassed).toBe(5);
    expect(r.standardsTotal).toBe(5);
  });

  it("exposes a link back to the full breakdown", () => {
    expect(r.sourceUrl).toBeTruthy();
  });
});

describe("standards count", () => {
  it("is null when the page does not state one", () => {
    // Non-compliant pages give a reason instead of an N/M count.
    expect(parse("jpm").standardsPassed).toBeNull();
    expect(parse("jpm").standardsTotal).toBeNull();
  });

  it("parses a partial pass", () => {
    // A holding can read "Compliant" while passing only some standards — the
    // headline verdict follows the primary standard. Camden Property Trust is
    // 1/5 and PepsiCo is 3/5 in the live data, so this must not be assumed 5/5.
    const html = `<html><body>
      <p>Compliant</p><p>Acme Inc</p><p>ACME</p><p>Compliant</p>
      <p>Exchange</p><p>NASDAQ</p>
      <p>Acme Inc is Shariah Compliant. It passes 3/5 Shariah standards we screen against.</p>
      <p>1.00%</p><p>Impure Income*</p>
    </body></html>`;
    const r = parseDetailPage(html, "x");
    expect(r.standardsPassed).toBe(3);
    expect(r.standardsTotal).toBe(5);
  });
});

describe("JPM — non-compliant, sparse ratio rows", () => {
  const r = parse("jpm");

  it("reads status and the offending activity", () => {
    expect(r.status).toBe("NOT_COMPLIANT");
    expect(r.ticker).toBe("JPM");
    expect(r.nonComplianceReason).toBe("Banks (NEC)");
  });

  it("returns null (not 0) for the suppressed metrics", () => {
    expect(r.impureIncomePct).toBeNull();
    expect(r.zakatPerShareUsd).toBeNull();
  });

  it("still reports a purification figure", () => {
    // Non-compliant stocks carry a purification amount even though impure
    // income and zakat render as "-".
    expect(r.purificationPerShareUsd).toBe(12.141);
  });

  it("survives a ratio row that has a checkmark but no percentage", () => {
    const aaoifi = r.ratios.find((x) => x.methodology === "AAOIFI")!;
    expect(aaoifi.debtPct).toBe(100);
    // JPMorgan's AAOIFI "Non-Compliant Assets" row has no value at all.
    expect(aaoifi.nonCompliantAssetsPct).toBeNull();
  });

  it("picks up FTSE's different row labels", () => {
    const ftse = r.ratios.find((x) => x.methodology === "FTSE")!;
    expect(ftse.debtPct).toBe(25.17);
    expect(ftse.nonCompliantAssetsPct).toBe(0); // FTSE reports "Cash"
  });
});

describe("other fixtures parse coherently", () => {
  it.each([
    ["msft", "MSFT", "COMPLIANT", 3.3, 0.368],
    ["tsla", "TSLA", "COMPLIANT", 1.9, 0.113],
  ])("%s", (name, ticker, status, impure, purification) => {
    const r = parse(name);
    expect(r.ticker).toBe(ticker);
    expect(r.status).toBe(status);
    expect(r.impureIncomePct).toBe(impure);
    expect(r.purificationPerShareUsd).toBe(purification);
  });

  it("parses a Canadian listing", () => {
    const r = parse("shop");
    expect(r.ticker).toBe("SHOP");
    expect(r.companyName).toMatch(/Shopify/i);
    expect(r.status).toBe("COMPLIANT");
    expect(r.ratios.length).toBeGreaterThan(0);
  });
});

describe("CCO — page emitting three header values under four labels", () => {
  // This layout broke an earlier offset-based summary extraction: counting
  // "four labels then four values" landed past the verdict sentence and
  // returned an empty assessment. The parser now anchors on the sentence.
  const r = parse("cco");

  it("still finds the verdict sentence", () => {
    expect(r.summary).toMatch(/Cameco Corp is Shariah Compliant/i);
    expect(r.summary).not.toBe("");
  });

  it("reads the metric cards correctly", () => {
    expect(r.ticker).toBe("CCO.TO");
    expect(r.status).toBe("COMPLIANT");
    expect(r.impureIncomePct).toBe(1.17);
    expect(r.purificationPerShareUsd).toBe(0.016);
    expect(r.zakatPerShareUsd).toBe(0.179);
  });

  it("reads exchange and sector despite the missing value", () => {
    expect(r.exchange).toBe("The Toronto Stock Exchange");
    expect(r.sector).toBe("Energy");
  });
});

describe("every fixture produces a non-empty summary", () => {
  it.each(["aapl", "msft", "tsla", "jpm", "shop", "cco"])("%s", (name) => {
    const r = parse(name);
    expect(r.summary.length).toBeGreaterThan(10);
    expect(r.summary).toMatch(/Shariah Compliant/i);
  });
});

describe("failure behaviour", () => {
  it("throws rather than returning silent nulls when the layout changes", () => {
    expect(() => parseDetailPage("<html><body><p>nothing</p></body></html>", "x")).toThrow(
      /layout may have changed/i,
    );
  });
});
