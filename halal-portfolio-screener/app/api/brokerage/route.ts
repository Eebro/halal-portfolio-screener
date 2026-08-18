/**
 * Brokerage connection endpoints (SnapTrade).
 *
 * GET  -> is SnapTrade configured, and a connection-portal URL if so
 * POST -> fetch live holdings and scan them
 *
 * Both degrade to a clear, actionable message when the env vars are absent so
 * the CSV path never looks broken just because SnapTrade is not set up.
 */
import { NextResponse } from "next/server";
import { isConfigured, createConnectionLink, fetchHoldings } from "@/lib/holdings/snaptrade";
import { scanHoldings } from "@/lib/scan";
import { getUsdToCad } from "@/lib/fx";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  if (!isConfigured()) {
    return NextResponse.json({
      configured: false,
      message:
        "SnapTrade is not configured. Add SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY to .env.local, or upload a CSV instead.",
    });
  }

  try {
    const url = await createConnectionLink();
    return NextResponse.json({ configured: true, connectionUrl: url });
  } catch (err) {
    return NextResponse.json(
      {
        configured: true,
        error: err instanceof Error ? err.message : "Could not create a connection link.",
      },
      { status: 502 },
    );
  }
}

export async function POST() {
  if (!isConfigured()) {
    return NextResponse.json(
      {
        error:
          "SnapTrade is not configured. Add SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY to .env.local, or upload a CSV instead.",
      },
      { status: 400 },
    );
  }

  try {
    const holdings = await fetchHoldings();
    const fx = await getUsdToCad();
    const scan = await scanHoldings(holdings, {}, fx?.usdToCad ?? null);

    return NextResponse.json({ ...scan, portfolioAsOf: null, fx });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not fetch holdings." },
      { status: 502 },
    );
  }
}
