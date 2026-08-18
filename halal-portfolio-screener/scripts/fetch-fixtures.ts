/**
 * Saves a handful of real detail pages as golden fixtures.
 *
 * The parser is anchored on label text in an Elementor-generated page with no
 * semantic classes. If the source redesigns, these fixtures are what turn a
 * silent wrong-number bug into a loud test failure.
 *
 * Run: npm run fixtures
 */
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const UA = "halal-portfolio-screener/0.1 (hackday project) node-fetch";

/**
 * Chosen to cover the layout variants seen in the wild:
 *  - aapl: compliant, full ratio set, four header values
 *  - jpm:  non-compliant, sparse ratio rows, reason split across nodes
 *  - cco:  compliant but emits only THREE header values under four labels,
 *          which broke offset-based summary extraction
 *  - shop: Canadian listing
 */
const FIXTURES: Record<string, string> = {
  aapl: "aapl-apple-inc-2",
  msft: "msft-microsoft-corp-2",
  tsla: "tsla-tesla-inc-2",
  jpm: "jpm-jpmorgan-chase-co-2",
  shop: "shop-shopify-inc-3",
  cco: "cco-cameco-corp-2",
};

async function main() {
  const dir = join(process.cwd(), "data", "fixtures");
  await mkdir(dir, { recursive: true });

  for (const [name, slug] of Object.entries(FIXTURES)) {
    const url = `https://spscreener.mxcorporate.com/appstocks/${slug}/`;
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) {
      console.error(`  ${name}: HTTP ${res.status}`);
      continue;
    }
    const html = await res.text();
    await writeFile(join(dir, `${name}.html`), html);
    console.log(`  ${name}: ${(html.length / 1024).toFixed(0)}kb from ${slug}`);
  }
}

main().catch((err) => {
  console.error("fetch-fixtures failed:", err);
  process.exit(1);
});
