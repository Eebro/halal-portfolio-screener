/**
 * SnapTrade integration — the "connect your brokerage" path.
 *
 * Wealthsimple has no public API, so SnapTrade is the practical way to reach
 * it; it also covers Questrade (read-only) through the same interface.
 *
 * Setup (see README):
 *   SNAPTRADE_CLIENT_ID
 *   SNAPTRADE_CONSUMER_KEY
 *
 * Limitation of the free Personal tier: it is scoped to YOUR OWN brokerage
 * accounts. Other people cannot connect theirs, which is why CSV upload is a
 * first-class path rather than a fallback.
 *
 * On typing: SnapTrade's response shapes are external and cannot be verified
 * here without live credentials, so this module keeps our own domain types
 * strict while treating the SDK boundary as unknown and guarding at runtime.
 * A shape change upstream surfaces as a clear error, not a silent bad holding.
 */
import { Snaptrade, SnaptradeAuth } from "snaptrade-typescript-sdk";
import type { Holding, SecurityType } from "@/lib/types";

export function isConfigured(): boolean {
  return Boolean(process.env.SNAPTRADE_CLIENT_ID && process.env.SNAPTRADE_CONSUMER_KEY);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function client(): any {
  const clientId = process.env.SNAPTRADE_CLIENT_ID;
  const consumerKey = process.env.SNAPTRADE_CONSUMER_KEY;
  if (!clientId || !consumerKey) {
    throw new Error(
      "SnapTrade is not configured. Set SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY, or use CSV upload instead.",
    );
  }
  return new Snaptrade({
    auth: SnaptradeAuth.personalApiKey({ clientId, consumerKey }),
  } as any);
}

/**
 * The SDK returns either `{ data }` or a thunk depending on the call variant.
 * Normalize both so callers deal with one shape.
 */
async function unwrap(result: any): Promise<any> {
  const resolved = typeof result === "function" ? await result() : await result;
  return resolved?.data ?? resolved;
}

/** Builds the hosted connection-portal URL the user visits to link a brokerage. */
export async function createConnectionLink(): Promise<string> {
  const snaptrade = client();
  // Data access only — a screening tool has no business holding trade rights.
  const data = await unwrap(
    snaptrade.authentication.loginSnapTradeUser({ connectionType: "read" }),
  );
  const url = data?.redirectURI ?? data?.redirectUri;
  if (typeof url !== "string") {
    throw new Error("SnapTrade did not return a connection URL.");
  }
  return url;
}

/**
 * Maps a SnapTrade instrument type onto our security types.
 *
 * SnapTrade's vocabulary differs from Wealthsimple's CSV. Getting this wrong
 * would route an ETF into the stock screener — which has no ETF coverage —
 * and produce a spurious "unresolved" for a perfectly known fund.
 */
export function toSecurityType(raw: string | undefined | null): SecurityType {
  const s = (raw ?? "").toLowerCase();
  if (s.includes("crypto")) return "CRYPTOCURRENCY";
  if (s.includes("etf") || s.includes("fund") || s.includes("etn")) {
    return "EXCHANGE_TRADED_FUND";
  }
  if (s.includes("cash") || s.includes("currency")) return "CURRENCY";
  if (s.includes("metal") || s.includes("commodity") || s.includes("bullion")) {
    return "PRECIOUS_METAL";
  }
  return "EQUITY";
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Normalizes one SnapTrade position into our Holding shape. */
export function positionToHolding(position: any, accountName: string, accountType: string): Holding | null {
  // SnapTrade nests the instrument under symbol.symbol, but some payloads
  // flatten it so symbol.symbol is the ticker string itself. Pick the level
  // that is actually an object, otherwise `info.symbol` reads off a string.
  const nested = position?.symbol?.symbol;
  const info =
    nested && typeof nested === "object" ? nested : (position?.symbol ?? {});
  const symbol = str(info?.symbol ?? info?.raw_symbol);
  if (!symbol) return null;

  const quantity = num(position?.units ?? position?.quantity);
  const price = num(position?.price);
  const currency = str(info?.currency?.code) || "CAD";

  return {
    symbol,
    name: str(info?.description ?? info?.name),
    securityType: toSecurityType(str(info?.type?.description) || str(info?.type?.code)),
    // SnapTrade exposes the exchange MIC, which is exactly the key our
    // resolver needs to tell Barrick's ABX from Abacus Global's.
    mic: str(info?.exchange?.mic_code ?? info?.exchange?.mic).toUpperCase(),
    exchange: str(info?.exchange?.code ?? info?.exchange?.name),
    quantity,
    direction: quantity < 0 ? "SHORT" : "LONG",
    marketPrice: price,
    marketPriceCurrency: currency,
    marketValue: quantity * price,
    marketValueCurrency: currency,
    bookValueCad: null,
    accountName,
    accountType,
  };
}

/** Fetches all positions across the user's connected accounts. */
export async function fetchHoldings(): Promise<Holding[]> {
  const snaptrade = client();

  const accounts = await unwrap(snaptrade.accountInformation.listUserAccounts({}));
  if (!Array.isArray(accounts)) {
    throw new Error("SnapTrade returned an unexpected account list shape.");
  }

  const holdings: Holding[] = [];

  for (const account of accounts) {
    const accountId = account?.id;
    if (!accountId) continue;

    const accountName =
      str(account?.name) || str(account?.institution_name) || "Brokerage";
    const accountType = str(account?.meta?.type ?? account?.raw_type);

    const positions = await unwrap(
      snaptrade.accountInformation.getUserAccountPositions({ accountId }),
    );
    if (!Array.isArray(positions)) continue;

    for (const p of positions) {
      const holding = positionToHolding(p, accountName, accountType);
      if (holding) holdings.push(holding);
    }
  }

  if (holdings.length === 0) {
    throw new Error(
      "SnapTrade returned no positions. Make sure a brokerage is connected to your SnapTrade account.",
    );
  }

  return holdings;
}
