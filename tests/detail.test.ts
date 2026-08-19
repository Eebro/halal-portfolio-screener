/**
 * Cache-validity rules for on-disk screener detail pages.
 *
 * This is a regression test for a real bug: the ratio table's pass/fail
 * marks were added to `ScreenResult` without bumping the cache's schema
 * version, so an on-disk entry written before the change had no
 * `debtPass`/`nonCompliantAssetsPass`/`impureIncomePass` fields at all —
 * `undefined`, not `null`. The UI's "is this unassessed?" check compared
 * against `null`, so `undefined` fell through and rendered as a fail mark on
 * every ratio for every holding, including fully compliant ones.
 *
 * `isCacheEntryValid` is the fix: any shape change bumps SCHEMA_VERSION, and
 * a mismatched version is treated as a cache miss rather than served as-is.
 */
import { describe, it, expect } from "vitest";
import { isCacheEntryValid } from "@/lib/screener/detail";

const NOW = 1_700_000_000_000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

describe("isCacheEntryValid", () => {
  it("rejects a schema version from before a ScreenResult shape change", () => {
    // This is the exact scenario that produced the bug: an entry written by
    // an older build, missing fields the current code expects.
    expect(isCacheEntryValid({ at: NOW, schemaVersion: 1 }, NOW)).toBe(false);
  });

  it("rejects an entry with no schema version at all", () => {
    // Cache files written before schema versioning existed.
    expect(isCacheEntryValid({ at: NOW }, NOW)).toBe(false);
  });

  it("accepts a fresh entry on the current schema version", () => {
    const CURRENT = isCacheEntryValid({ at: NOW, schemaVersion: 2 }, NOW);
    expect(CURRENT).toBe(true);
  });

  it("rejects an entry older than the TTL even on the current schema", () => {
    const eightDaysAgo = NOW - 8 * ONE_DAY_MS;
    expect(isCacheEntryValid({ at: eightDaysAgo, schemaVersion: 2 }, NOW)).toBe(false);
  });

  it("accepts an entry within the TTL window", () => {
    const sixDaysAgo = NOW - 6 * ONE_DAY_MS;
    expect(isCacheEntryValid({ at: sixDaysAgo, schemaVersion: 2 }, NOW)).toBe(true);
  });

  it("rejects malformed or missing entries without throwing", () => {
    expect(isCacheEntryValid(null, NOW)).toBe(false);
    expect(isCacheEntryValid(undefined, NOW)).toBe(false);
    expect(isCacheEntryValid({ schemaVersion: 2 }, NOW)).toBe(false); // no `at`
  });
});
