/**
 * Scan endpoint.
 *
 * Accepts either raw CSV text or an already-normalized holdings array, so the
 * same path serves CSV upload and (later) SnapTrade.
 *
 * The uploaded file is parsed in memory and never written to disk or logged —
 * it is somebody's full financial position.
 */
import { NextResponse } from "next/server";
import { parseWealthsimpleCsv } from "@/lib/holdings/csv";
import { scanHoldings } from "@/lib/scan";
import { getUsdToCad } from "@/lib/fx";
import type { Holding } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

interface ScanRequest {
  csv?: string;
  holdings?: Holding[];
  /** Dividends received per symbol, in USD, for dividend-based purification. */
  dividends?: Record<string, number>;
}

export async function POST(request: Request) {
  let body: ScanRequest;
  try {
    body = (await request.json()) as ScanRequest;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  let holdings: Holding[] = [];
  let csvWarnings: string[] = [];
  let asOf: string | null = null;

  if (typeof body.csv === "string" && body.csv.trim().length > 0) {
    const parsed = parseWealthsimpleCsv(body.csv);
    holdings = parsed.holdings;
    csvWarnings = parsed.warnings;
    asOf = parsed.asOf;
  } else if (Array.isArray(body.holdings)) {
    holdings = body.holdings;
  } else {
    return NextResponse.json(
      { error: "Provide either `csv` text or a `holdings` array." },
      { status: 400 },
    );
  }

  if (holdings.length === 0) {
    return NextResponse.json(
      {
        error:
          csvWarnings[0] ??
          "No holdings found in that file. Export a holdings report from Wealthsimple and upload it here.",
        warnings: csvWarnings,
      },
      { status: 422 },
    );
  }

  try {
    // The rate is fetched first because portfolio totals depend on it — a
    // scan that sums USD and CAD positions raw would misstate the compliant
    // percentage.
    const fx = await getUsdToCad();
    const scan = await scanHoldings(holdings, body.dividends ?? {}, fx?.usdToCad ?? null);

    return NextResponse.json({
      ...scan,
      warnings: [...csvWarnings, ...scan.warnings],
      portfolioAsOf: asOf,
      fx,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Scan failed: ${message}` }, { status: 500 });
  }
}
