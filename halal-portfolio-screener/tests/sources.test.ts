/**
 * Guards the cited sources in the purification guide.
 *
 * Structural checks run offline and always. The liveness check is opt-in via
 * CHECK_LINKS=1 so CI does not fail on someone else's outage, but it exists so
 * rot can be caught deliberately:
 *
 *   CHECK_LINKS=1 npx vitest run tests/sources.test.ts
 */
import { describe, it, expect } from "vitest";
import { SOURCES } from "@/components/PurificationGuide";

describe("cited sources", () => {
  it("cites the standard the app's own numbers come from", () => {
    // AAOIFI SS-21 governs share screening and purification; the per-share
    // figures in this app are computed on that basis, so it must be listed.
    const aaoifi = SOURCES.find((s) => s.href.includes("aaoifi.com"));
    expect(aaoifi).toBeDefined();
    expect(aaoifi!.href).toContain("ss-21");
  });

  it("cites the dividend-only methodology behind the second figure", () => {
    expect(SOURCES.some((s) => /spglobal\.com/.test(s.href))).toBe(true);
  });

  it("uses only https and well-formed URLs", () => {
    for (const s of SOURCES) {
      expect(() => new URL(s.href)).not.toThrow();
      expect(new URL(s.href).protocol).toBe("https:");
    }
  });

  it("has no duplicate links and explains why each is cited", () => {
    const hrefs = SOURCES.map((s) => s.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const s of SOURCES) {
      expect(s.label.trim().length).toBeGreaterThan(10);
      expect(s.note.trim().length).toBeGreaterThan(20);
    }
  });

  it("does not cite the screener's dead MSCI link", () => {
    // The upstream page 404s; reproducing it would send readers nowhere.
    expect(SOURCES.some((s) => s.href.includes("msci.com"))).toBe(false);
  });
});

describe.runIf(process.env.CHECK_LINKS === "1")("source liveness", () => {
  it.each(SOURCES.map((s) => [s.label, s.href]))(
    "%s resolves",
    async (_label, href) => {
      const res = await fetch(href, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
        },
      });
      // Some publishers bot-block automated requests; a 403 still means the
      // page exists, whereas a 404 means we are sending readers nowhere.
      expect(res.status).not.toBe(404);
    },
    30_000,
  );
});
