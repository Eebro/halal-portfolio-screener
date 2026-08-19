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
 * accounts. SnapTrade's Developer Terms describe the free tier as "a single
 * Connected User with up to five (5) brokerage connections" — that is one
 * person's accounts, not five different visitors. There is no free way to
 * let arbitrary site visitors connect their own brokerage; that requires
 * SnapTrade's paid Commercial tier (per-visitor identity, billing on file).
 * So this app deliberately only supports "clone the repo, run it with your
 * own SnapTrade key" rather than a shared multi-tenant deployment.
 *
 * On typing: the shapes below are taken directly from
 * node_modules/snaptrade-typescript-sdk's generated .d.ts (v12.1.3) — not
 * from the SDK's README, which only documents the Commercial flow and never
 * mentions personalApiKey at all. Verified against source:
 *   - AccountPosition.units / .price are STRINGS ("58.375"), not numbers.
 *   - AccountPosition.instrument holds the symbol info directly (kind,
 *     symbol, raw_symbol, description, currency, exchange as flat strings) —
 *     there is no nested `symbol.symbol` object and no `exchange.mic_code`.
 *   - getAllAccountPositions (not getUserAccountPositions, which does not
 *     exist on this client) returns `{ results: AccountPosition[], ... }`,
 *     not a bare array.
 * An earlier version of this file used getUserAccountPositions with a bare
 * array assumption and nested symbol/exchange object paths; none of those
 * matched the real SDK, so every position resolved to a false "no data"
 * without ever throwing — it always returned zero holdings.
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
 * Maps a SnapTrade instrument `kind` (plus, for the one case `kind` can't
 * disambiguate, the instrument's `exchange` string) onto our security types.
 *
 * `kind` is a closed enum on the SDK's discriminated union
 * (stock/etf/mutualfund/crypto/adr/cef/cfd/future/option/other) — an exact
 * tag match, not a guess from free-text the way an early version of this
 * function worked (matching on a human-readable "type description").
 *
 * Verified against a real connected Wealthsimple account: physically-backed
 * gold comes through as `kind: "other"` (SnapTrade's catch-all bucket, not a
 * dedicated precious-metal kind) with `exchange: "WST-PRECIOUS-METAL"`. Since
 * "other" also covers genuinely unclassifiable instruments, the exchange
 * string is the only reliable signal for this one case — `kind` alone would
 * route Wealthsimple's physical gold into the stock screener, where "GOLD"
 * fails to resolve to any real ticker and shows up as "Unresolved" instead of
 * the correct "informational, not screened" treatment the CSV path already
 * gives this same asset class.
 */
export function toSecurityType(
  kind: string | undefined | null,
  exchange?: string | undefined | null,
): SecurityType {
  if (exchange === "WST-PRECIOUS-METAL") return "PRECIOUS_METAL";

  switch (kind) {
    case "crypto":
      return "CRYPTOCURRENCY";
    case "etf":
    case "mutualfund":
      return "EXCHANGE_TRADED_FUND";
    // SnapTrade has no distinct "cash"/"currency" instrument kind — cash
    // balances surface separately via account balances, not as a position
    // with an instrument.
    case "stock":
    case "adr":
    case "cef":
    case "cfd":
    case "future":
    case "option":
    case "other":
    default:
      return "EQUITY";
  }
}

/** Parses a numeric string field. SnapTrade returns units/price as strings. */
function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Normalizes one SnapTrade `AccountPosition` into our Holding shape.
 *
 * `position.instrument` is a discriminated union (kind: 'stock' | 'etf' |
 * 'crypto' | ...) whose variants all share the same flat symbol/currency/
 * exchange fields — verified directly against the SDK's generated types,
 * not assumed from documentation.
 */
export function positionToHolding(position: any, accountName: string, accountType: string): Holding | null {
  const instrument = position?.instrument ?? {};
  const symbol = str(instrument?.symbol ?? instrument?.raw_symbol);
  if (!symbol) return null;

  const quantity = num(position?.units);
  const price = num(position?.price);
  // The instrument's own currency is the reliable field; position.currency
  // is a top-level convenience the SDK does not guarantee on every variant.
  const currency = str(instrument?.currency) || "CAD";

  return {
    symbol,
    name: str(instrument?.description) || symbol,
    securityType: toSecurityType(str(instrument?.kind), str(instrument?.exchange)),
    // SnapTrade's `exchange` is already a bare MIC/exchange-code string, not
    // an object — this is exactly the key our resolver uses to tell
    // Barrick's ABX from Abacus Global's ABX on NYSE.
    mic: str(instrument?.exchange).toUpperCase(),
    exchange: str(instrument?.exchange),
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

    const accountName = str(account?.name) || str(account?.institution_name) || "Brokerage";
    const accountType = str(account?.raw_type);

    // getAllAccountPositions (NOT getUserAccountPositions, which this SDK
    // does not expose) returns { results: AccountPosition[], data_freshness }.
    const response = await unwrap(
      snaptrade.accountInformation.getAllAccountPositions({ accountId }),
    );
    const positions = response?.results;
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
