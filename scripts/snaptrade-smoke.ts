/**
 * Live smoke test against a real SnapTrade Personal account.
 *
 * Exercises fetchHoldings() end-to-end — the one part of the SnapTrade
 * integration that unit tests cannot cover, since it needs a real connected
 * brokerage. Run: npx tsx scripts/snaptrade-smoke.ts
 *
 * Loads .env.local manually since tsx (unlike `next dev`) does not read it
 * automatically.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

function loadEnvLocal() {
  const path = join(process.cwd(), ".env.local");
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    console.error(".env.local not found. Add SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY there first.");
    process.exit(1);
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvLocal();

async function main() {
  const { isConfigured, fetchHoldings } = await import("@/lib/holdings/snaptrade");
  const { scanHoldings } = await import("@/lib/scan");
  const { getUsdToCad } = await import("@/lib/fx");

  if (!isConfigured()) {
    console.error("SnapTrade is not configured — check .env.local.");
    process.exit(1);
  }

  console.log("Fetching holdings from SnapTrade...\n");
  const t0 = Date.now();
  const holdings = await fetchHoldings();
  console.log(`Fetched ${holdings.length} holdings in ${Date.now() - t0}ms\n`);

  const pad = (s: unknown, n: number) => String(s).padEnd(n);
  console.log(
    pad("SYMBOL", 10) +
      pad("TYPE", 22) +
      pad("QTY", 12) +
      pad("PRICE", 12) +
      pad("VALUE", 14) +
      pad("CUR", 5) +
      pad("EXCHANGE", 10) +
      "ACCOUNT",
  );
  for (const h of holdings) {
    console.log(
      pad(h.symbol, 10) +
        pad(h.securityType, 22) +
        pad(h.quantity, 12) +
        pad(h.marketPrice, 12) +
        pad(h.marketValue.toFixed(2), 14) +
        pad(h.marketValueCurrency, 5) +
        pad(h.exchange || h.mic, 10) +
        h.accountName,
    );
  }

  const zeroQty = holdings.filter((h) => h.quantity === 0);
  const zeroPrice = holdings.filter((h) => h.marketPrice === 0);
  if (zeroQty.length > 0) {
    console.warn(`\nWARNING: ${zeroQty.length} holding(s) have quantity 0 — check units parsing.`);
  }
  if (zeroPrice.length > 0) {
    console.warn(`WARNING: ${zeroPrice.length} holding(s) have price 0 — check price parsing.`);
  }

  console.log("\n--- Running full scan (routing, screening, purification) ---\n");
  const fx = await getUsdToCad();
  const t1 = Date.now();
  const scan = await scanHoldings(holdings, {}, fx?.usdToCad ?? null);
  console.log(`Scan took ${Date.now() - t1}ms\n`);

  console.log(
    pad("SYMBOL", 10) + pad("ROUTE", 14) + pad("STATUS", 15) + pad("AAOIFI", 11) + "DETAIL",
  );
  for (const h of scan.holdings) {
    const p = h.purification;
    const detail =
      h.status === "NOT_COMPLIANT"
        ? (h.screen?.nonComplianceReason ?? "")
        : h.status === "COMPLIANT"
          ? ""
          : h.explanation.slice(0, 60);
    console.log(
      pad(h.holding.symbol, 10) +
        pad(h.route, 14) +
        pad(h.status, 15) +
        pad(p.aaoifiUsd === null ? "-" : `$${p.aaoifiUsd}`, 11) +
        detail,
    );
  }

  console.log("\nSUMMARY:", JSON.stringify(scan.summary, null, 2));
  if (scan.warnings.length) console.log("\nSCAN WARNINGS:", scan.warnings);
}

main().catch((err) => {
  console.error("\nsnaptrade-smoke failed:", err);
  process.exit(1);
});
