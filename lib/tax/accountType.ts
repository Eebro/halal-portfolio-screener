/**
 * Classifies a holding's account into the tax treatment that applies if its
 * value were withdrawn/liquidated today. This drives the Zakat calculator's
 * per-account haircut (see lib/zakat.ts) — getting this wrong either
 * overstates zakat (treating a taxable RRSP as tax-free) or understates it
 * (treating a real account as unrecognized and defaulting it to full value,
 * which is actually the safer default — see below).
 *
 * Two different sources feed `Holding.accountType`/`accountName`, and neither
 * is a clean enum:
 *   - CSV upload: clean values ("TFSA", "RRSP", "FHSA", "Non-registered").
 *   - SnapTrade: noisier real account names confirmed against a live account,
 *     e.g. "Wealthsimple Trade FHSA", "Wealthsimple Trade PERSONAL" — the
 *     institution name is prepended, so an exact match against "FHSA" would
 *     miss it.
 * Matching is therefore substring-based against both fields, not an exact
 * equality check against either one alone.
 */
import type { Holding } from "@/lib/types";

export type AccountTaxCategory = "TFSA" | "RRSP" | "FHSA" | "NON_REGISTERED" | "OTHER";

/**
 * Order matters: FHSA must be checked before a generic "registered"-style
 * match, and RRSP before RRIF-like substrings, so a more specific label isn't
 * shadowed by a broader one.
 */
const PATTERNS: { category: AccountTaxCategory; re: RegExp }[] = [
  { category: "TFSA", re: /\bTFSA\b/i },
  { category: "FHSA", re: /\bFHSA\b/i },
  { category: "RRSP", re: /\bRRSP\b/i },
  {
    category: "NON_REGISTERED",
    re: /non[\s-]?registered|personal|individual|margin|cash account/i,
  },
];

/**
 * Classifies a holding's account. Defaults to `OTHER` — treated identically
 * to NON_REGISTERED (full value, no tax haircut) by the zakat calculator —
 * for anything unrecognized. This is the safe direction to default in: it
 * never silently assumes an account is tax-advantaged when it might not be,
 * which would understate zakat owed.
 */
export function classifyAccountType(holding: Pick<Holding, "accountType" | "accountName">): AccountTaxCategory {
  const haystack = `${holding.accountType} ${holding.accountName}`;
  for (const { category, re } of PATTERNS) {
    if (re.test(haystack)) return category;
  }
  return "OTHER";
}
