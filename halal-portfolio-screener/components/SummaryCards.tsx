"use client";

import type { ScanSummary } from "@/lib/scan";

function money(n: number, currency: string): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(n);
}

interface Props {
  summary: ScanSummary;
  fx: { usdToCad: number; date: string } | null;
  showCad: boolean;
}

export function SummaryCards({ summary, fx, showCad }: Props) {
  // Purification is published in USD, so it converts on demand. Market values
  // are already normalized to CAD by the scan and must NOT be converted again.
  const cur = showCad && fx ? "CAD" : "USD";
  const conv = (usd: number) => (showCad && fx ? usd * fx.usdToCad : usd);

  const p = summary.purification;
  const unverified = summary.unresolvedCount + summary.needsReviewCount;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card
        label="Compliant by value"
        value={
          summary.compliantPctByValue === null ? "—" : `${summary.compliantPctByValue}%`
        }
        sub={
          `${summary.compliantCount} of ${summary.compliantCount + summary.nonCompliantCount} verified positions` +
          (summary.valuesFxNormalized ? "" : " · currencies not normalized")
        }
        tone={
          summary.compliantPctByValue === null
            ? "neutral"
            : summary.compliantPctByValue >= 95
              ? "good"
              : summary.compliantPctByValue >= 80
                ? "warn"
                : "bad"
        }
      />
      <Card
        label="Purification owed"
        value={money(conv(p.aaoifiUsd), cur)}
        sub="AAOIFI basis, current period"
        tone={p.aaoifiUsd > 0 ? "warn" : "neutral"}
      />
      <Card
        label="Non-compliant positions"
        value={String(summary.nonCompliantCount)}
        sub={
          summary.nonCompliantCount === 0
            ? "Nothing flagged"
            : "Review these holdings"
        }
        tone={summary.nonCompliantCount > 0 ? "bad" : "good"}
      />
      <Card
        label="Needs your attention"
        value={String(unverified)}
        sub={
          unverified === 0
            ? "Everything screened"
            : `${money(summary.unverifiedValueCad, "CAD")} unverified`
        }
        tone={unverified > 0 ? "warn" : "good"}
      />
    </div>
  );
}

function Card({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "good" | "warn" | "bad" | "neutral";
}) {
  const toneClass = {
    good: "text-[var(--color-compliant)]",
    warn: "text-[var(--color-review)]",
    bad: "text-[var(--color-noncompliant)]",
    neutral: "text-[var(--color-ink)]",
  }[tone];

  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-white p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
        {label}
      </div>
      <div className={`tnum mt-1.5 text-2xl font-semibold ${toneClass}`}>{value}</div>
      <div className="mt-1 text-xs text-[var(--color-muted)]">{sub}</div>
    </div>
  );
}
