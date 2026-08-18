/**
 * End-to-end smoke test against the live screener, using the sample CSV.
 * Run: npx tsx scripts/smoke.ts
 */
import { readFileSync } from "node:fs";
import { parseWealthsimpleCsv } from "@/lib/holdings/csv";
import { scanHoldings } from "@/lib/scan";

const pad = (s: unknown, n: number) => String(s).padEnd(n);

async function main() {
  const csv = readFileSync("data/fixtures/sample-holdings.csv", "utf8");
  const { holdings, asOf, warnings } = parseWealthsimpleCsv(csv);
  console.log(`Parsed ${holdings.length} holdings (as of ${asOf})`);
  if (warnings.length) console.log("CSV warnings:", warnings);

  const t0 = Date.now();
  const out = await scanHoldings(holdings, { SPUS: 120, MSFT: 30 });
  console.log(`Scan took ${Date.now() - t0}ms\n`);

  console.log(
    pad("SYMBOL", 9) + pad("ROUTE", 14) + pad("STATUS", 15) +
      pad("AAOIFI", 11) + pad("DIV-BASED", 11) + "DETAIL",
  );
  for (const h of out.holdings) {
    const p = h.purification;
    const detail =
      h.status === "NOT_COMPLIANT"
        ? (h.screen?.nonComplianceReason ?? "")
        : h.status === "COMPLIANT"
          ? ""
          : h.explanation.slice(0, 70);
    console.log(
      pad(h.holding.symbol, 9) +
        pad(h.route, 14) +
        pad(h.status, 15) +
        pad(p.aaoifiUsd === null ? "-" : `$${p.aaoifiUsd}`, 11) +
        pad(p.dividendBasedUsd === null ? "-" : `$${p.dividendBasedUsd}`, 11) +
        detail,
    );
  }

  console.log("\nSUMMARY:", JSON.stringify(out.summary, null, 2));
  console.log("source updated on:", out.sourceUpdatedOn);
  if (out.warnings.length) console.log("scan warnings:", out.warnings);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
