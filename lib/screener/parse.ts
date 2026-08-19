/**
 * Parses a ShariaPortfolio screener detail page into structured data.
 *
 * The pages are Elementor-generated: every element carries a random `data-id`
 * and there are no semantic classes, so CSS selectors are not a stable
 * contract. Instead we flatten the document to an ordered list of text nodes
 * and anchor on label text.
 *
 * Adjacency differs by section, which is the main trap:
 *   - metric cards put the value BEFORE the label ("$0.236", "Purification*")
 *   - ratio rows put the value AFTER the label ("Debt", "1.95%")
 *
 * Two further traps found in real pages:
 *   - a ratio row may have a pass/fail mark but NO percentage (JPMorgan's
 *     AAOIFI "Non-Compliant Assets" is followed directly by a checkmark), so
 *     the value must be validated, not assumed
 *   - the row set differs per methodology (AAOIFI has "Non-Compliant Assets";
 *     FTSE/MSCI have "Cash" and "Cash & AR" instead), so blocks are delimited
 *     by their "... Rulebook:" marker rather than assumed to be uniform
 */
import type { MethodologyRatios, RatioPass, ScreenResult } from "@/lib/types";

const ENTITIES: [RegExp, string][] = [
  [/&#8211;|&#8212;|&ndash;|&mdash;/g, "-"],
  [/&#8217;|&#8216;|&rsquo;|&lsquo;/g, "'"],
  [/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"'],
  [/&#038;|&amp;/g, "&"],
  [/&lt;/g, "<"],
  [/&gt;/g, ">"],
  [/&nbsp;|&#160;/g, " "],
  [/&quot;/g, '"'],
];

export function decodeEntities(s: string): string {
  let out = s;
  for (const [re, rep] of ENTITIES) out = out.replace(re, rep);
  return out.replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

/** Flatten HTML to ordered, non-empty text nodes. */
export function textNodes(html: string): string[] {
  const stripped = html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ");
  return stripped
    .split(/<[^>]+>/)
    .map((s) => decodeEntities(s).replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0);
}

/** "3.14%" -> 3.14 ; "-" or missing -> null. Never coerces absent data to 0. */
export function parsePct(v: string | undefined): number | null {
  if (!v) return null;
  const m = v.trim().match(/^(-?[\d,]+(?:\.\d+)?)\s*%$/);
  if (!m) return null;
  return Number(m[1].replace(/,/g, ""));
}

/** "$0.236" -> 0.236 ; "-" or missing -> null. */
export function parseMoney(v: string | undefined): number | null {
  if (!v) return null;
  const m = v.trim().match(/^\$?\s*(-?[\d,]+(?:\.\d+)?)$/);
  if (!m) return null;
  return Number(m[1].replace(/,/g, ""));
}

/** "✓" -> true ; "✗" -> false ; anything else -> null. */
export function parsePassMark(v: string | undefined): RatioPass {
  if (v === "✓") return true;
  if (v === "✗") return false;
  return null;
}

const RULEBOOKS: { marker: RegExp; methodology: MethodologyRatios["methodology"] }[] = [
  { marker: /^AAOIFI Rulebook:/i, methodology: "AAOIFI" },
  { marker: /^S&P Sharia Rulebook:/i, methodology: "S&P" },
  { marker: /^Dow Jones Islamic Market \(DJIM\) Rulebook:/i, methodology: "DJIM" },
  { marker: /^FTSE Shariah Rulebook:/i, methodology: "FTSE" },
  { marker: /^MSCI Islamic Rulebook:/i, methodology: "MSCI" },
];

const RATIO_LABELS = new Set(["Debt", "Non-Compliant Assets", "Impure Income", "Cash", "Cash & AR"]);

/**
 * Each ratio row renders as `label, [percentage], mark` where mark is a ✓/✗
 * immediately after the percentage — or immediately after the label when
 * there is no percentage to show (JPMorgan's AAOIFI "Non-Compliant Assets"
 * has no value, just a mark). This reads whichever shape is present rather
 * than assuming a fixed offset.
 */
function readRatioRow(block: string[], labelIdx: number): { pct: number | null; pass: RatioPass } {
  const afterLabel = block[labelIdx + 1];
  const pct = parsePct(afterLabel);
  if (pct !== null) {
    return { pct, pass: parsePassMark(block[labelIdx + 2]) };
  }
  // No percentage: the mark (if any) sits directly after the label.
  return { pct: null, pass: parsePassMark(afterLabel) };
}

/**
 * Each methodology's rows appear BEFORE its "... Rulebook:" marker. We walk
 * the markers in order and take the slice since the previous block ended.
 */
function parseRatioBlocks(nodes: string[]): MethodologyRatios[] {
  const out: MethodologyRatios[] = [];
  let searchFrom = 0;

  for (const { marker, methodology } of RULEBOOKS) {
    const markerIdx = nodes.findIndex((n, i) => i >= searchFrom && marker.test(n));
    if (markerIdx === -1) continue;

    const block = nodes.slice(searchFrom, markerIdx);
    const values: Record<string, { pct: number | null; pass: RatioPass }> = {};
    for (let i = 0; i < block.length; i++) {
      const label = block[i];
      if (!RATIO_LABELS.has(label)) continue;
      values[label] = readRatioRow(block, i);
    }

    // AAOIFI reports "Non-Compliant Assets"; FTSE/MSCI report "Cash".
    const nonCompliant = values["Non-Compliant Assets"] ?? values["Cash"];

    out.push({
      methodology,
      debtPct: values["Debt"]?.pct ?? null,
      debtPass: values["Debt"]?.pass ?? null,
      nonCompliantAssetsPct: nonCompliant?.pct ?? null,
      nonCompliantAssetsPass: nonCompliant?.pass ?? null,
      impureIncomePct: values["Impure Income"]?.pct ?? null,
      impureIncomePass: values["Impure Income"]?.pass ?? null,
    });

    // Skip past the rulebook prose and "Source:" line for this block.
    const nextStart = nodes.findIndex(
      (n, i) => i > markerIdx && /^Source:$/i.test(n),
    );
    searchFrom = nextStart === -1 ? markerIdx + 1 : nextStart + 2;
  }

  return out;
}

function parseBreakdown(nodes: string[]): { category: string; pct: number | null }[] {
  const start = nodes.findIndex((n) => /^Impure Income Breakdown$/i.test(n));
  if (start === -1) return [];
  const end = nodes.findIndex((n, i) => i > start && /^Note on Purification/i.test(n));
  const slice = nodes.slice(start + 1, end === -1 ? start + 12 : end);

  const out: { category: string; pct: number | null }[] = [];
  for (let i = 0; i < slice.length; i += 2) {
    const category = slice[i];
    if (!category || category === "-") continue;
    out.push({ category, pct: parsePct(slice[i + 1]) });
  }
  return out;
}

export function parseDetailPage(html: string, sourceUrl: string): ScreenResult {
  const nodes = textNodes(html);

  const statusIdx = nodes.findIndex((n) => /^(Compliant|Not Compliant)$/i.test(n));
  if (statusIdx === -1) {
    throw new Error(
      `Could not find a compliance status on ${sourceUrl}. The source page layout may have changed.`,
    );
  }

  const status = /^Not/i.test(nodes[statusIdx]) ? "NOT_COMPLIANT" : "COMPLIANT";
  const ticker = nodes[statusIdx - 1] ?? "";
  const companyName = nodes[statusIdx - 2] ?? "";

  const labelValue = (label: string): string | null => {
    const li = nodes.findIndex((n, i) => i > statusIdx && i < statusIdx + 12 && n === label);
    if (li === -1) return null;
    // The four header labels are emitted as a run, then their four values.
    const runStart = nodes.findIndex((n, i) => i > statusIdx && n === "Exchange");
    if (runStart === -1) return null;
    const offset = li - runStart;
    return nodes[runStart + 4 + offset] ?? null;
  };

  const exchange = labelValue("Exchange");
  const sector = labelValue("Sector");

  // Metric cards: value precedes label.
  const valueBefore = (label: string): string | undefined => {
    const i = nodes.findIndex((n) => n === label);
    return i > 0 ? nodes[i - 1] : undefined;
  };
  const impureIncomePct = parsePct(valueBefore("Impure Income*"));
  const purificationPerShareUsd = parseMoney(valueBefore("Purification*"));
  const zakatPerShareUsd = parseMoney(valueBefore("Zakat*"));

  // The verdict sentence sits between the header block and the first metric
  // card. Non-compliant pages split it across three nodes around the reason.
  //
  // Anchor on the sentence itself rather than counting header nodes: the
  // header emits four labels but not always four values (Cameco's page omits
  // the "Group" value), so a fixed offset silently lands past the summary.
  const impureCardIdx = nodes.findIndex((n) => n === "Impure Income*");
  const sentenceIdx = nodes.findIndex(
    (n, i) => i > statusIdx && /\bis (?:not )?Shariah Compliant\b/i.test(n),
  );
  const summary =
    sentenceIdx === -1
      ? ""
      : nodes
          .slice(sentenceIdx, impureCardIdx === -1 ? sentenceIdx + 1 : Math.max(sentenceIdx + 1, impureCardIdx - 1))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();

  const reasonMatch = summary.match(/involvement in\s+(.+?)\s+and related activities/i);
  const nonComplianceReason = reasonMatch ? reasonMatch[1].trim() : null;

  // "It passes 3/5 Shariah standards we screen against."
  const standardsMatch = summary.match(/passes\s+(\d+)\s*\/\s*(\d+)\s+Shariah standards/i);
  const standardsPassed = standardsMatch ? Number(standardsMatch[1]) : null;
  const standardsTotal = standardsMatch ? Number(standardsMatch[2]) : null;

  const updatedNode = nodes.find((n) => /^Updated on /i.test(n));
  const updatedOn = updatedNode ? updatedNode.replace(/^Updated on\s*/i, "").trim() : null;

  return {
    ticker,
    companyName,
    status,
    summary,
    nonComplianceReason,
    standardsPassed,
    standardsTotal,
    impureIncomePct,
    purificationPerShareUsd,
    zakatPerShareUsd,
    ratios: parseRatioBlocks(nodes),
    impureIncomeBreakdown: parseBreakdown(nodes),
    exchange,
    sector,
    updatedOn,
    sourceUrl,
  };
}
