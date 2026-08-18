/**
 * Resolves a broker-reported symbol to a record in the screener index.
 *
 * This is the correctness-critical file. Tickers are not unique across
 * exchanges, and collisions flip verdicts. Two real examples from the index:
 *
 *   ABX  The Toronto Stock Exchange  COMPLIANT      Barrick Mining Corp
 *   ABX  NYSE                        NOT-COMPLIANT  Abacus Global Management Inc
 *
 *   CCO  The Toronto Stock Exchange  COMPLIANT      Cameco Corp
 *   CCO  NYSE                        NOT-COMPLIANT  Clear Channel Outdoor Holdings Inc
 *
 * Taking the first match would report the wrong answer for a TSX holder of
 * either. We therefore match on exchange *and* company name, and refuse to
 * guess when the evidence is ambiguous.
 */
import type { IndexEntry, ScreenerIndex } from "@/scripts/build-index";

export type { IndexEntry, ScreenerIndex };

/**
 * The source has four distinct Toronto exchange terms ("TSX", "TSE",
 * "Toronto Stock Exchange", "The Toronto Stock Exchange") and two venture
 * ones. A MIC therefore maps to a *set* of taxonomy terms, not one.
 */
const EXCHANGE_GROUPS: Record<string, string[]> = {
  TSX: ["TSX", "TSE", "Toronto Stock Exchange", "The Toronto Stock Exchange"],
  TSXV: ["Toronto Venture Exchange", "Canadian Ventures Exchange"],
  NYSE: ["NYSE"],
  NASDAQ: ["NASDAQ"],
  NYSE_MKT: ["NYSE MKT"],
  OTC: ["OTC", "OTCM"],
  TOKYO: ["XTKS"],
};

/** ISO 10383 MIC -> exchange group. */
const MIC_TO_GROUP: Record<string, string> = {
  XTSE: "TSX",
  XTSX: "TSXV",
  XNYS: "NYSE",
  XNAS: "NASDAQ",
  XASE: "NYSE_MKT",
  ARCX: "NYSE",
  BATS: "NASDAQ",
  XTKS: "TOKYO",
  OTCM: "OTC",
  // Deliberately absent: NEOE (Cboe Canada) and XCNQ (CSE) have no counterpart
  // in the source's 12 exchanges. Holdings there resolve to UNRESOLVED rather
  // than being force-matched onto a different listing.
};

/** Broker exchange labels -> group, used when MIC is missing. */
const LABEL_TO_GROUP: Record<string, string> = {
  TSX: "TSX",
  "TSX-V": "TSXV",
  TSXV: "TSXV",
  NYSE: "NYSE",
  NASDAQ: "NASDAQ",
  AMEX: "NYSE_MKT",
};

export function micToGroup(mic: string, exchangeLabel = ""): string | null {
  const byMic = MIC_TO_GROUP[mic.trim().toUpperCase()];
  if (byMic) return byMic;
  return LABEL_TO_GROUP[exchangeLabel.trim().toUpperCase()] ?? null;
}

export function normalizeTicker(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/\.(TO|TSX|V|NE|CN|U)$/i, "")
    .replace(/[_.]U$/i, "")
    .trim();
}

const CORPORATE_SUFFIXES =
  /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|plc|sa|nv|ag|group|holdings?|the|class|series|common|shares?)\b/g;

/** Reduce a company name to comparable tokens: "Cameco Corporation" -> {cameco}. */
export function nameTokens(name: string): Set<string> {
  const cleaned = name
    .toLowerCase()
    .replace(/\(.*?\)/g, " ") // drop parentheticals like "(Canada)"
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(CORPORATE_SUFFIXES, " ")
    .replace(/\s+/g, " ")
    .trim();
  return new Set(cleaned.split(" ").filter((t) => t.length > 1));
}

/** Jaccard-ish overlap, biased toward the shorter name being fully contained. */
export function nameSimilarity(a: string, b: string): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size);
}

export interface ResolveInput {
  symbol: string;
  /** Company name from the broker; the strongest disambiguator we have. */
  name?: string;
  mic?: string;
  exchange?: string;
}

export interface ResolveCandidate {
  entry: IndexEntry;
  exchangeName: string;
  score: number;
}

export type ResolveOutcome =
  | { kind: "resolved"; entry: IndexEntry; exchangeName: string; candidates: ResolveCandidate[] }
  /** Matches exist but disagree on the verdict — never silently pick one. */
  | { kind: "conflict"; candidates: ResolveCandidate[]; reason: string }
  | { kind: "unresolved"; candidates: ResolveCandidate[]; reason: string };

export class TickerResolver {
  private byTicker = new Map<string, IndexEntry[]>();
  private exchangeName: Record<string, string>;
  private groupOfTerm = new Map<string, string>();

  constructor(index: ScreenerIndex) {
    this.exchangeName = index.exchanges;
    for (const [group, names] of Object.entries(EXCHANGE_GROUPS)) {
      for (const [id, name] of Object.entries(index.exchanges)) {
        if (names.includes(name)) this.groupOfTerm.set(id, group);
      }
    }
    for (const e of index.entries) {
      const list = this.byTicker.get(e.t);
      if (list) list.push(e);
      else this.byTicker.set(e.t, [e]);
    }
  }

  private groupFor(entry: IndexEntry): string | null {
    return entry.e === null ? null : (this.groupOfTerm.get(String(entry.e)) ?? null);
  }

  resolve(input: ResolveInput): ResolveOutcome {
    const ticker = normalizeTicker(input.symbol);
    const matches = this.byTicker.get(ticker) ?? [];

    if (matches.length === 0) {
      return {
        kind: "unresolved",
        candidates: [],
        reason: `No record for "${input.symbol}" in the screener dataset.`,
      };
    }

    const wantGroup = micToGroup(input.mic ?? "", input.exchange ?? "");
    const wantName = input.name ?? "";

    const scored: ResolveCandidate[] = matches.map((entry) => {
      const group = this.groupFor(entry);
      let score = 0;

      // Exchange agreement is the primary signal.
      if (wantGroup && group) score += group === wantGroup ? 100 : -60;

      // Company name is the tie-breaker that actually separates Barrick from
      // Abacus, since both legitimately trade as ABX.
      if (wantName) score += nameSimilarity(wantName, entry.n) * 80;

      // Tiny nudge toward the exact raw form the broker used.
      if (entry.raw.toUpperCase() === input.symbol.trim().toUpperCase()) score += 5;

      // Prefer records that carry a usable verdict.
      if (entry.v === "?") score -= 10;

      return { entry, exchangeName: this.exchangeName[String(entry.e)] ?? "unknown", score };
    });

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];

    // A confident match needs either exchange agreement or a strong name match.
    const nameOk = wantName ? nameSimilarity(wantName, best.entry.n) >= 0.5 : false;
    const exchangeOk = wantGroup ? this.groupFor(best.entry) === wantGroup : false;

    if (!nameOk && !exchangeOk) {
      return {
        kind: "unresolved",
        candidates: scored.slice(0, 6),
        reason: wantGroup
          ? `"${input.symbol}" exists but no listing matches ${wantGroup} and the company name did not match.`
          : `"${input.symbol}" is ambiguous and no exchange was supplied to disambiguate it.`,
      };
    }

    // Among candidates that are equally good matches, a disagreement on the
    // verdict is a source-data conflict (F4 Uranium is one). Report it rather
    // than picking a side — the whole point of the app is the verdict.
    const topTier = scored.filter((c) => c.score >= best.score - 5);
    const verdicts = new Set(topTier.map((c) => c.entry.v).filter((v) => v !== "?"));
    if (verdicts.size > 1) {
      return {
        kind: "conflict",
        candidates: topTier.slice(0, 6),
        reason: `The source lists conflicting verdicts for "${input.symbol}" on equally-matching listings.`,
      };
    }

    return {
      kind: "resolved",
      entry: best.entry,
      exchangeName: best.exchangeName,
      candidates: scored.slice(0, 6),
    };
  }
}

let cached: TickerResolver | null = null;

/** Loads the committed index once per process. Server-side only. */
export async function getResolver(): Promise<TickerResolver> {
  if (cached) return cached;
  const index = (await import("@/data/screener-index.json")).default as unknown as ScreenerIndex;
  cached = new TickerResolver(index);
  return cached;
}
