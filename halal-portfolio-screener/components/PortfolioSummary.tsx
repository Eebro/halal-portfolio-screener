"use client";

import type { ScanSummary } from "@/lib/scan";

function cad(n: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(n);
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}

/**
 * Portfolio-level totals. Everything here is CAD-normalized by the scan, so no
 * further conversion happens at render time — converting twice was a real bug
 * earlier and this component deliberately does no arithmetic on currency.
 */
export function PortfolioSummary({ summary }: { summary: ScanSummary }) {
  const total = summary.totalPortfolioValueCad;
  const topAccounts = summary.accounts.slice(0, 6);

  return (
    <section className="rounded-xl border border-[var(--color-line)] bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
            Total portfolio value
          </div>
          <div className="tnum mt-1 text-3xl font-semibold">{cad(total)}</div>
          <div className="mt-1 text-xs text-[var(--color-muted)]">
            {summary.distinctAssets} assets across {summary.totalPositions} positions
            {summary.accounts.length > 1 && <> in {summary.accounts.length} accounts</>}
            {summary.valuesFxNormalized ? "" : " · currencies not normalized"}
          </div>
        </div>

        <div className="flex gap-6 text-right">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
              Invested
            </div>
            <div className="tnum mt-1 text-lg font-semibold">{cad(summary.investedValueCad)}</div>
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
              Cash
            </div>
            <div className="tnum mt-1 text-lg font-semibold">{cad(summary.cashValueCad)}</div>
          </div>
        </div>
      </div>

      {topAccounts.length > 1 && (
        <div className="mt-5">
          <div className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
            By account
          </div>
          <div className="mt-2 space-y-1.5">
            {topAccounts.map((a) => (
              <div key={a.name} className="flex items-center gap-3">
                <div className="w-32 shrink-0 truncate text-sm">{a.name}</div>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-neutral-chip-bg)]">
                  <div
                    className="h-full rounded-full bg-[var(--color-compliant)]"
                    style={{ width: `${pct(a.valueCad, total)}%` }}
                  />
                </div>
                <div className="tnum w-28 shrink-0 text-right text-sm">{cad(a.valueCad)}</div>
                <div className="tnum w-12 shrink-0 text-right text-xs text-[var(--color-muted)]">
                  {pct(a.valueCad, total)}%
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
