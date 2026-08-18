/**
 * Builds the local ticker index from the ShariaPortfolio screener's public
 * WordPress REST API.
 *
 * Why a build-time index rather than per-request search: the upstream
 * `?search=` endpoint ranks by relevance, and short tickers get buried. `SU`,
 * `TRI` and `AG` all return zero useful hits when searched by ticker even
 * though all three exist in the dataset. Exact matching over a complete local
 * index is the only way to resolve them correctly. It is also much faster —
 * ~20.5k records fetched once, then every lookup is an in-memory hit.
 *
 * Run: npm run build:index
 */
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const BASE = "https://spscreener.mxcorporate.com/wp-json/wp/v2";
const CPT = "appstocks"; // widest coverage of the four stock CPTs (~20.5k)
const PER_PAGE = 100;
const CONCURRENCY = 4; // deliberately gentle on a third-party host
const UA =
  "halal-portfolio-screener/0.1 (hackday project; contact via repo) node-fetch";

export interface IndexEntry {
  /** Normalized ticker, uppercase, suffix stripped. e.g. "AEM" from "AEM.TO". */
  t: string;
  /** Raw ticker as published, e.g. "AEM.TO". Kept for display/debugging. */
  raw: string;
  /** Company name. */
  n: string;
  /** WP slug — used to build the detail-page URL. */
  s: string;
  /** Exchange taxonomy term id. */
  e: number | null;
  /** Sector taxonomy term id. */
  sec: number | null;
  /** Compliance verdict derived from the summary sentence. */
  v: "C" | "N" | "?";
}

export interface ScreenerIndex {
  builtAt: string;
  source: string;
  cpt: string;
  exchanges: Record<string, string>; // term id -> exchange name
  sectors: Record<string, string>;
  entries: IndexEntry[];
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#8211;/g, "-")
    .replace(/&#8212;/g, "-")
    .replace(/&#8217;/g, "'")
    .replace(/&#8216;/g, "'")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/&#038;|&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

/** Strip exchange suffixes so "AEM.TO" and "AEM" collapse to one key. */
export function normalizeTicker(raw: string): string {
  return decodeEntities(raw)
    .trim()
    .toUpperCase()
    .replace(/\.(TO|TSX|V|NE|CN|U)$/i, "")
    .replace(/[_.]U$/i, "") // TSXV unit shares, e.g. "RPR_u"
    .trim();
}

/**
 * Titles are published as "TICKER – Company Name" (en-dash). Split on the
 * first dash-like separator only; company names frequently contain hyphens
 * (e.g. "Alimentation-Couche Tard, Inc.").
 */
export function splitTitle(rendered: string): { ticker: string; name: string } {
  const t = decodeEntities(rendered).trim();
  const m = t.match(/^(\S+)\s+[-–—]\s+(.*)$/);
  if (m) return { ticker: m[1].trim(), name: m[2].trim() };
  return { ticker: t.split(/\s+/)[0] ?? t, name: t };
}

/** Derive a verdict from the summary sentence in `content.rendered`. */
export function verdictFromContent(html: string): "C" | "N" | "?" {
  const text = decodeEntities(html.replace(/<[^>]*>/g, " "));
  if (/is not Shariah Compliant|is not shariah/i.test(text)) return "N";
  if (/is Shariah Compliant/i.test(text)) return "C";
  return "?";
}

async function getJson(url: string, retries = 3): Promise<{ body: any; headers: Headers }> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return { body: await res.json(), headers: res.headers };
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw new Error("unreachable");
}

async function fetchTaxonomy(name: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const { body } = await getJson(`${BASE}/${name}?per_page=100&_fields=id,name`);
  for (const term of body as { id: number; name: string }[]) {
    out[String(term.id)] = term.name;
  }
  return out;
}

async function main() {
  console.log("Fetching taxonomies...");
  const [exchanges, sectors] = await Promise.all([
    fetchTaxonomy("exchange"),
    fetchTaxonomy("sector"),
  ]);
  console.log(
    `  ${Object.keys(exchanges).length} exchanges, ${Object.keys(sectors).length} sectors`,
  );

  // `_fields` keeps the payload small — without it each page carries a lot of
  // Elementor metadata we never read.
  const fields = "id,slug,title,content,exchange,sector";
  const first = await getJson(
    `${BASE}/${CPT}?per_page=${PER_PAGE}&page=1&_fields=${fields}`,
  );
  const totalPages = Number(first.headers.get("x-wp-totalpages") ?? "1");
  const totalItems = Number(first.headers.get("x-wp-total") ?? "0");
  console.log(`Indexing ${totalItems} records across ${totalPages} pages...`);

  const entries: IndexEntry[] = [];
  const addPage = (rows: any[]) => {
    for (const r of rows) {
      const { ticker, name } = splitTitle(r?.title?.rendered ?? "");
      if (!ticker) continue;
      entries.push({
        t: normalizeTicker(ticker),
        raw: decodeEntities(ticker),
        n: name,
        s: r.slug,
        e: Array.isArray(r.exchange) ? (r.exchange[0] ?? null) : null,
        sec: Array.isArray(r.sector) ? (r.sector[0] ?? null) : null,
        v: verdictFromContent(r?.content?.rendered ?? ""),
      });
    }
  };

  addPage(first.body);

  // Simple worker pool over the remaining pages.
  const pages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
  let cursor = 0;
  let done = 0;
  const worker = async () => {
    while (cursor < pages.length) {
      const page = pages[cursor++];
      const { body } = await getJson(
        `${BASE}/${CPT}?per_page=${PER_PAGE}&page=${page}&_fields=${fields}`,
      );
      addPage(body);
      done++;
      if (done % 25 === 0) {
        process.stdout.write(`  ${done}/${pages.length} pages, ${entries.length} entries\n`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const index: ScreenerIndex = {
    builtAt: new Date().toISOString(),
    source: "https://spscreener.mxcorporate.com (ShariaPortfolio / SP Funds)",
    cpt: CPT,
    exchanges,
    sectors,
    entries,
  };

  const dataDir = join(process.cwd(), "data");
  await mkdir(dataDir, { recursive: true });
  const outPath = join(dataDir, "screener-index.json");
  await writeFile(outPath, JSON.stringify(index));

  // Report enough to make a bad build obvious rather than silently shipping.
  const byVerdict = entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.v] = (acc[e.v] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`\nWrote ${outPath}`);
  console.log(`  entries: ${entries.length} (expected ~${totalItems})`);
  console.log(`  verdicts: compliant=${byVerdict.C ?? 0} non-compliant=${byVerdict.N ?? 0} unknown=${byVerdict["?"] ?? 0}`);
  const uniqueTickers = new Set(entries.map((e) => e.t)).size;
  console.log(`  unique normalized tickers: ${uniqueTickers}`);
}

main().catch((err) => {
  console.error("build-index failed:", err);
  process.exit(1);
});
