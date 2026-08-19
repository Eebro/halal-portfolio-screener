"use client";

import { useEffect, useState } from "react";
import { SummaryCards } from "@/components/SummaryCards";
import { PortfolioSummary } from "@/components/PortfolioSummary";
import { PurificationGuide } from "@/components/PurificationGuide";
import { HoldingsTable } from "@/components/HoldingsTable";
import type { ScreenedHolding } from "@/lib/types";
import type { ScanSummary } from "@/lib/scan";

interface ScanResponse {
  holdings: ScreenedHolding[];
  summary: ScanSummary;
  warnings: string[];
  sourceUpdatedOn: string | null;
  portfolioAsOf: string | null;
  fx: { usdToCad: number; date: string } | null;
}

export default function Page() {
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCad, setShowCad] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [brokerage, setBrokerage] = useState<{
    configured: boolean;
    connectionUrl?: string;
    message?: string;
  } | null>(null);

  useEffect(() => {
    // Probe once so the brokerage option only appears when it can actually work.
    fetch("/api/brokerage")
      .then((r) => r.json())
      .then(setBrokerage)
      .catch(() => setBrokerage({ configured: false }));
  }, []);

  async function importFromBrokerage() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/brokerage", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Could not import from your brokerage.");
        return;
      }
      setResult(body as ScanResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach the brokerage endpoint.");
    } finally {
      setLoading(false);
    }
  }

  async function runScan(csv: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Scan failed.");
        setResult(null);
        return;
      }
      setResult(body as ScanResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach the scan endpoint.");
    } finally {
      setLoading(false);
    }
  }

  async function handleFile(file: File) {
    const text = await file.text();
    await runScan(text);
  }

  async function loadSample() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/sample-holdings.csv");
      await runScan(await res.text());
    } catch {
      setError("Could not load the sample file.");
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Halal Portfolio Screener</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-[var(--color-muted)]">
          Upload a Wealthsimple holdings export to screen every position for Shariah compliance
          and see exactly how much purification you owe.
        </p>
      </header>

      {!result && (
        <>
          <section className="mb-6 rounded-xl border border-[var(--color-line)] bg-white p-5">
            <h2 className="text-sm font-semibold">Where to get your CSV</h2>
            <p className="mt-1 text-xs text-[var(--color-review)]">
              Only Wealthsimple exports are supported right now.
            </p>
            <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-[var(--color-muted)]">
              <li>
                Go to{" "}
                <a
                  href="https://my.wealthsimple.com/app/holdings-dashboard"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-medium text-[var(--color-ink)] underline"
                >
                  my.wealthsimple.com/app/holdings-dashboard
                </a>{" "}
                (the Holdings tab in your Wealthsimple account).
              </li>
              <li>
                Click <strong className="text-[var(--color-ink)]">Export</strong> in the top
                right of that page.
              </li>
              <li>Upload the downloaded CSV below, or drag it into the box.</li>
            </ol>
          </section>

          <section
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void handleFile(file);
            }}
            className={`rounded-xl border-2 border-dashed p-10 text-center transition ${
              dragging
                ? "border-[var(--color-compliant)] bg-[var(--color-compliant-bg)]"
                : "border-[var(--color-line)] bg-white"
            }`}
          >
            <p className="text-sm font-medium">Drop your holdings CSV here</p>
            <p className="mt-1 text-xs text-[var(--color-muted)]">
              The file is read in memory and never stored.
            </p>

            <div className="mt-5 flex items-center justify-center gap-3">
              <label className="cursor-pointer rounded-lg bg-[var(--color-ink)] px-4 py-2 text-sm font-medium text-white hover:opacity-90">
                Choose file
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleFile(file);
                  }}
                />
              </label>
              <button
                onClick={() => void loadSample()}
                className="rounded-lg border border-[var(--color-line)] bg-white px-4 py-2 text-sm font-medium hover:bg-[#fafbfc]"
              >
                Try sample data
              </button>
            </div>

            {brokerage?.configured && (
              <div className="mt-6 border-t border-[var(--color-line)] pt-5">
                <p className="text-xs text-[var(--color-muted)]">
                  Or connect a brokerage directly via SnapTrade (Wealthsimple and Questrade).
                </p>
                <div className="mt-3 flex items-center justify-center gap-3">
                  {brokerage.connectionUrl && (
                    <a
                      href={brokerage.connectionUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="rounded-lg border border-[var(--color-line)] bg-white px-4 py-2 text-sm font-medium hover:bg-[#fafbfc]"
                    >
                      Link an account
                    </a>
                  )}
                  <button
                    onClick={() => void importFromBrokerage()}
                    className="rounded-lg border border-[var(--color-line)] bg-white px-4 py-2 text-sm font-medium hover:bg-[#fafbfc]"
                  >
                    Import linked holdings
                  </button>
                </div>
              </div>
            )}
          </section>
        </>
      )}

      {loading && (
        <div className="mt-6 rounded-xl border border-[var(--color-line)] bg-white p-6 text-center text-sm text-[var(--color-muted)]">
          Screening holdings…
        </div>
      )}

      {error && (
        <div className="mt-6 rounded-xl border border-[var(--color-noncompliant)] bg-[var(--color-noncompliant-bg)] p-4 text-sm text-[var(--color-noncompliant)]">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-[var(--color-muted)]">
              {result.portfolioAsOf && <>Portfolio as of {result.portfolioAsOf}. </>}
              {result.sourceUpdatedOn && <>Screening data updated {result.sourceUpdatedOn}. </>}
              {result.fx && (
                <>
                  USD→CAD {result.fx.usdToCad.toFixed(4)} ({result.fx.date}).
                </>
              )}
            </div>
            <div className="flex items-center gap-3">
              {result.fx && (
                <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--color-muted)]">
                  <input
                    type="checkbox"
                    checked={showCad}
                    onChange={(e) => setShowCad(e.target.checked)}
                    className="h-4 w-4 rounded border-[var(--color-line)]"
                  />
                  Show purification in CAD
                </label>
              )}
              <button
                onClick={() => {
                  setResult(null);
                  setError(null);
                }}
                className="rounded-lg border border-[var(--color-line)] bg-white px-3 py-1.5 text-sm font-medium hover:bg-[#fafbfc]"
              >
                Scan another file
              </button>
            </div>
          </div>

          <PortfolioSummary summary={result.summary} />

          <SummaryCards summary={result.summary} fx={result.fx} showCad={showCad} />

          {result.warnings.length > 0 && (
            <div className="rounded-xl border border-[var(--color-review)] bg-[var(--color-review-bg)] p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-review)]">
                Worth knowing
              </div>
              <ul className="mt-1.5 space-y-1">
                {result.warnings.map((w, i) => (
                  <li key={i} className="text-sm text-[var(--color-review)]">
                    • {w}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <HoldingsTable holdings={result.holdings} fx={result.fx} showCad={showCad} />

          <PurificationGuide />

          <section className="rounded-xl border border-[var(--color-line)] bg-white p-5 text-xs leading-relaxed text-[var(--color-muted)]">
            <p className="font-semibold text-[var(--color-ink)]">How purification is calculated</p>
            <p className="mt-1.5">
              <strong>AAOIFI</strong> publishes a USD amount per share owed every financial period
              (typically quarterly), whether or not the company paid a dividend. We multiply it by
              your share count and do not annualize it.{" "}
              <strong>Dividend-based (S&amp;P)</strong> applies the impure-income percentage to
              dividends you actually received, so nothing is owed on a non-dividend payer. Funds are
              purified on dividends using their published quarterly rate.
            </p>
            <p className="mt-3 font-semibold text-[var(--color-ink)]">Limitations</p>
            <p className="mt-1.5">
              Stock data comes from the{" "}
              <a
                className="underline"
                href="https://www.sp-funds.com/stock-screener/"
                target="_blank"
                rel="noreferrer noopener"
              >
                SP Funds / ShariaPortfolio screener
              </a>{" "}
              and is a periodic snapshot, not live. ETFs are matched against a small curated
              registry because the screener does not cover funds — anything unrecognized is marked
              &ldquo;needs review&rdquo; rather than assumed. Listings on the CSE and Cboe Canada
              are not covered by the source data.
            </p>
            <p className="mt-3">
              <strong className="text-[var(--color-ink)]">This is not a fatwa.</strong> It is an
              informational tool built on third-party data. Cryptocurrency in particular is a
              genuinely contested question and this app deliberately does not assert a verdict on
              it. Consult a qualified scholar for rulings that apply to your situation.
            </p>
          </section>
        </div>
      )}
    </main>
  );
}
