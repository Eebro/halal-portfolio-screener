/**
 * Fetches and caches screener detail pages.
 *
 * The upstream data only changes about quarterly, so caching is both a large
 * speed win and the polite thing to do against a third-party host we do not
 * own. Cache lives on disk under .cache/ and is keyed by slug.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parseDetailPage } from "@/lib/screener/parse";
import type { ScreenResult } from "@/lib/types";

const BASE = "https://spscreener.mxcorporate.com/appstocks";
const UA = "halal-portfolio-screener/0.1 (hackday project) node-fetch";
const CACHE_DIR = join(process.cwd(), ".cache", "detail");
/** Source refreshes roughly quarterly; a week is comfortably conservative. */
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

const memory = new Map<string, ScreenResult>();

function cachePath(slug: string): string {
  return join(CACHE_DIR, `${slug.replace(/[^a-z0-9_-]/gi, "_")}.json`);
}

async function readCache(slug: string): Promise<ScreenResult | null> {
  try {
    const raw = await readFile(cachePath(slug), "utf8");
    const { at, result } = JSON.parse(raw) as { at: number; result: ScreenResult };
    if (Date.now() - at > TTL_MS) return null;
    return result;
  } catch {
    return null;
  }
}

async function writeCache(slug: string, result: ScreenResult): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(cachePath(slug), JSON.stringify({ at: Date.now(), result }));
  } catch {
    // A cache write failure must never break a scan.
  }
}

export async function fetchScreenResult(slug: string): Promise<ScreenResult> {
  const hot = memory.get(slug);
  if (hot) return hot;

  const cached = await readCache(slug);
  if (cached) {
    memory.set(slug, cached);
    return cached;
  }

  const url = `${BASE}/${slug}/`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Screener returned HTTP ${res.status} for ${slug}`);

  const result = parseDetailPage(await res.text(), url);
  memory.set(slug, result);
  await writeCache(slug, result);
  return result;
}

/** Fetches many slugs with bounded concurrency. */
export async function fetchMany(
  slugs: string[],
  concurrency = 5,
): Promise<Map<string, ScreenResult | Error>> {
  const out = new Map<string, ScreenResult | Error>();
  const queue = [...new Set(slugs)];
  let cursor = 0;

  const worker = async () => {
    while (cursor < queue.length) {
      const slug = queue[cursor++];
      try {
        out.set(slug, await fetchScreenResult(slug));
      } catch (err) {
        out.set(slug, err instanceof Error ? err : new Error(String(err)));
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return out;
}
