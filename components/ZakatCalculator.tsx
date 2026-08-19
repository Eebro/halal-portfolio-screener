"use client";

import { useState } from "react";
import { computeZakat, type ZakatBreakdown } from "@/lib/zakat";
import { PROVINCE_LABELS, type ProvinceCode } from "@/lib/tax/brackets";
import type { ScreenedHolding } from "@/lib/types";

function cad(n: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 2,
  }).format(n);
}

const CATEGORY_LABEL: Record<ZakatBreakdown["categoryTotals"][number]["category"], string> = {
  TFSA: "TFSA",
  RRSP: "RRSP",
  FHSA: "FHSA",
  NON_REGISTERED: "Non-registered",
  // Cash inside this bucket is always full value; crypto/precious metal
  // inside it can carry a capital-gains haircut when a cost basis is known —
  // this label deliberately doesn't imply uniform treatment. The per-holding
  // "show your work" list is where that distinction is actually visible.
  OTHER: "Cash, crypto & other unclassified",
};

const PROVINCE_OPTIONS: ProvinceCode[] = [
  "AB",
  "BC",
  "MB",
  "NB",
  "NL",
  "NT",
  "NS",
  "NU",
  "ON",
  "PE",
  "QC",
  "SK",
  "YT",
];

/**
 * Zakat al-Mal calculator.
 *
 * The obligation isn't 2.5% of gross portfolio value — a large share of a
 * typical Wealthsimple portfolio sits in RRSP/FHSA accounts, and withdrawing
 * those today would trigger real income tax. That tax was never really the
 * user's wealth to begin with, so zakat is computed on the net (after-tax)
 * value: RRSP/FHSA get a marginal-tax haircut, non-registered accounts get a
 * capital-gains haircut on the unrealized gain, TFSA counts at full value.
 *
 * This mirrors the National Zakat Foundation Canada's own published RRSP
 * methodology (deduct tax owed on withdrawal, zakat the net) — see the
 * sources block below — except it computes the person's real marginal tax
 * rate from income + province rather than NZF's flat CRA withholding-tax
 * example, which is a prepayment estimate, not the final tax bill.
 *
 * Deliberately requires the user to enter income + province and press
 * "Calculate" rather than running automatically — this is a separate,
 * optional calculation, not part of the automatic compliance scan.
 */
export function ZakatCalculator({
  holdings,
  usdToCad,
}: {
  holdings: ScreenedHolding[];
  /**
   * Same rate used elsewhere on the page for USD→CAD normalization. Without
   * it, marketValueCad (shared with lib/scan.ts) falls back to book value or
   * raw face value for USD holdings — silently understating a USD RRSP/TFSA
   * position's true CAD value rather than converting it.
   */
  usdToCad: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [income, setIncome] = useState("");
  const [province, setProvince] = useState<ProvinceCode>("ON");
  const [result, setResult] = useState<ZakatBreakdown | null>(null);

  function handleCalculate() {
    const annualIncomeCad = Number(income);
    if (!Number.isFinite(annualIncomeCad) || annualIncomeCad < 0) return;
    setResult(
      computeZakat({
        holdings,
        annualIncomeCad,
        province,
        usdToCad,
      }),
    );
  }

  return (
    <section className="rounded-xl border border-[var(--color-line)] bg-white shadow-sm">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-3 p-5 text-left"
      >
        <div>
          <h2 className="text-sm font-semibold">Zakat al-Mal calculator</h2>
          <p className="mt-0.5 text-xs text-[var(--color-muted)]">
            2.5% of your net zakatable wealth — accounting for the tax you&rsquo;d owe if you
            withdrew your RRSP/FHSA today.
          </p>
        </div>
        <span className="shrink-0 text-[var(--color-muted)]">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="border-t border-[var(--color-line)] p-5">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs font-medium text-[var(--color-muted)]">
                Annual income (CAD)
              </span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step={1000}
                value={income}
                onChange={(e) => setIncome(e.target.value)}
                placeholder="e.g. 85000"
                className="w-40 rounded-lg border border-[var(--color-line)] px-2.5 py-1.5 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs font-medium text-[var(--color-muted)]">Province</span>
              <select
                value={province}
                onChange={(e) => setProvince(e.target.value as ProvinceCode)}
                className="rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-1.5 text-sm"
              >
                {PROVINCE_OPTIONS.map((code) => (
                  <option key={code} value={code}>
                    {PROVINCE_LABELS[code]}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={handleCalculate}
              disabled={!income}
              className="rounded-lg bg-[var(--color-ink)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
            >
              Calculate
            </button>
          </div>

          {province === "QC" && (
            <p className="mt-2 text-xs text-[var(--color-review)]">
              Quebec residents also receive a federal tax abatement (roughly 16.5% off federal
              tax, since Quebec collects its own provincial tax separately) that isn&rsquo;t
              modelled here — the figures below slightly overstate the tax haircut for Quebec.
            </p>
          )}

          {result && (
            <div className="mt-5">
              <ResultsSummary result={result} />
              <Walkthrough result={result} />
            </div>
          )}

          <Methodology />
        </div>
      )}
    </section>
  );
}

function ResultsSummary({ result }: { result: ZakatBreakdown }) {
  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[#fafbfc] p-4">
      <div className="grid gap-4 sm:grid-cols-4">
        <div>
          <div
            className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]"
            title="The rate on the next dollar at your stated income, before any withdrawal is added — a starting point, not the rate actually applied below. A large RRSP withdrawal can push well past this bracket; the per-account rate in the table below reflects what was actually used."
          >
            Marginal rate at your income ⓘ
          </div>
          <div className="tnum mt-1 text-xl font-semibold">{result.marginalRateAtIncomePct}%</div>
          <div className="mt-0.5 text-[11px] text-[var(--color-muted)]">
            starting point only — see actual rate applied below
          </div>
        </div>
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
            Net zakatable wealth
          </div>
          <div className="tnum mt-1 text-xl font-semibold">{cad(result.netZakatableCad)}</div>
        </div>
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
            Estimated tax haircut
          </div>
          <div className="tnum mt-1 text-xl font-semibold text-[var(--color-review)]">
            {cad(result.totalTaxCad)}
          </div>
        </div>
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
            Zakat due (2.5%)
          </div>
          <div className="tnum mt-1 text-xl font-semibold text-[var(--color-compliant)]">
            {cad(result.zakatDueCad)}
          </div>
        </div>
      </div>

      {result.categoryTotals.length > 0 && (
        <table className="tnum mt-4 w-full text-xs">
          <thead>
            <tr className="text-left text-[var(--color-muted)]">
              <th className="py-1 font-medium">Account type</th>
              <th className="py-1 text-right font-medium">Gross value</th>
              <th
                className="py-1 text-right font-medium"
                title="Tax ÷ gross value for this category — the actual rate applied, not the starting-point bracket above. For RRSP/FHSA this is the real stacked marginal rate on the withdrawal (it can span more than one bracket once added to your income, and will differ from the starting-point rate above for a large withdrawal). For non-registered accounts, only the unrealized gain is taxed (and only half of it), so this is a blended rate over the full gross value — much lower than the marginal rate actually charged on the gain itself."
              >
                Rate applied ⓘ
              </th>
              <th className="py-1 text-right font-medium">Tax haircut</th>
              <th className="py-1 text-right font-medium">Net zakatable</th>
            </tr>
          </thead>
          <tbody>
            {result.categoryTotals.map((c) => {
              // Tax ÷ gross for this category. For RRSP/FHSA this literally
              // is the stacked marginal rate (the whole withdrawal is
              // taxed), so it can exceed the "marginal rate at your income"
              // card above once a large withdrawal pushes into higher
              // brackets. For non-registered/OTHER it's a blended rate over
              // the full gross value, since only the gain (and only half of
              // it) is taxed — expected to look much lower than a bracket.
              const effectiveRatePct = c.grossValueCad > 0 ? (c.taxCad / c.grossValueCad) * 100 : 0;
              return (
                <tr key={c.category} className="border-t border-[var(--color-line)]">
                  <td className="py-1.5">{CATEGORY_LABEL[c.category]}</td>
                  <td className="py-1.5 text-right">{cad(c.grossValueCad)}</td>
                  <td className="py-1.5 text-right">
                    {c.taxCad > 0 ? `${effectiveRatePct.toFixed(1)}%` : "—"}
                  </td>
                  <td className="py-1.5 text-right">{c.taxCad > 0 ? cad(c.taxCad) : "—"}</td>
                  <td className="py-1.5 text-right font-medium">{cad(c.netValueCad)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {result.categoryTotals.some((c) => c.category === "RRSP" || c.category === "FHSA") && (
        <p className="mt-2 text-[11px] text-[var(--color-muted)]">
          RRSP/FHSA is taxed as a real withdrawal stacked on top of your income — it can span more
          than one tax bracket, so its rate above may run higher than the &ldquo;marginal rate at
          your income&rdquo; card once the withdrawal is large enough. Non-registered accounts show
          a lower blended rate because only the unrealized gain (half of it) is taxable, not the
          full balance.
        </p>
      )}

      {result.notes.length > 0 && (
        <ul className="mt-3 space-y-1">
          {result.notes.map((n, i) => (
            <li key={i} className="text-xs text-[var(--color-muted)]">
              • {n}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The literal per-holding arithmetic, spelled out — this is what the user
 * asked to make sure was visible on the app itself, not just documented in
 * the README. Each line already carries a plain-language explanation string
 * built in lib/zakat.ts with the real numbers substituted in.
 */
function Walkthrough({ result }: { result: ZakatBreakdown }) {
  const [expanded, setExpanded] = useState(false);
  if (result.lineItems.length === 0) return null;

  const visible = expanded ? result.lineItems : result.lineItems.slice(0, 5);

  return (
    <div className="mt-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        Show your work
      </div>
      <ul className="mt-2 space-y-2">
        {visible.map((item, i) => (
          <li key={`${item.symbol}-${item.accountName}-${i}`} className="text-xs">
            <span className="font-medium">
              {item.symbol} ({item.accountName})
            </span>
            <span className="text-[var(--color-muted)]"> — {item.explanation}</span>
          </li>
        ))}
      </ul>
      {result.lineItems.length > 5 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-2 text-xs font-medium underline"
        >
          {expanded ? "Show fewer" : `Show all ${result.lineItems.length} holdings`}
        </button>
      )}
      <p className="mt-3 text-xs text-[var(--color-muted)]">
        Roll-up: {cad(result.totalGrossCad)} gross across all holdings − {cad(result.totalTaxCad)}{" "}
        estimated tax = {cad(result.netZakatableCad)} net zakatable ×2.5% ={" "}
        <strong className="text-[var(--color-ink)]">{cad(result.zakatDueCad)} zakat due</strong>.
      </p>
    </div>
  );
}

function Methodology() {
  return (
    <div className="mt-5 space-y-3 border-t border-[var(--color-line)] pt-4 text-xs leading-relaxed text-[var(--color-muted)]">
      <p>
        <strong className="text-[var(--color-ink)]">Method used here:</strong> RRSP and FHSA
        holdings are counted net of the income tax you&rsquo;d owe if withdrawn today, computed at
        your real marginal rate (federal + provincial, stacked on your stated income) — not a flat
        rate. Non-registered holdings are counted net of capital gains tax (50% inclusion rate,
        2026) on the unrealized gain, when a cost basis is known. TFSA, cash, crypto and physically
        backed metal count at full value.
      </p>
      <p>
        This mirrors the{" "}
        <a
          href="https://www.nzfcanada.com/zakat-faq/how-do-i-calculate-zakat-on-my-retirement-savings-rrsp-and-tfsa"
          target="_blank"
          rel="noreferrer noopener"
          className="font-medium underline"
        >
          National Zakat Foundation Canada&rsquo;s published RRSP methodology ↗
        </a>{" "}
        — deduct the tax owed on withdrawal, zakat the net — except NZF&rsquo;s own worked example
        uses the flat CRA withholding-tax tiers (10/20/30%) as a stand-in for tax owed. Withholding
        is only a prepayment estimate; the real tax is the withdrawal taxed at your marginal rate
        when you file, which is what this calculator computes directly.
      </p>
      <div className="rounded-lg border border-[var(--color-review)] bg-[var(--color-review-bg)] p-3 text-[var(--color-review)]">
        <p className="font-semibold uppercase tracking-wide">Where scholars genuinely differ</p>
        <p className="mt-1.5">
          The Fiqh Council of North America takes a stricter view: no tax or penalty deduction on
          retirement accounts at all, since the liability doesn&rsquo;t exist until the withdrawal
          actually happens — some other bodies allow the deduction only once a withdrawal is
          actually made, not preemptively each year. This calculator uses the accessibility-based,
          tax-adjusted approach; it is one accepted method among several, not a ruling.
        </p>
      </div>
      <p>
        This is not a fatwa. It does not check your result against the current nisab threshold —
        confirm that separately. Consult a qualified scholar for guidance that applies to your
        situation.
      </p>
    </div>
  );
}
