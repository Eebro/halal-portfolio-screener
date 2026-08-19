"use client";

import { Fragment, useMemo, useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { groupHoldings, type GroupedHolding } from "@/lib/group";
import type { MethodologyRatios, RatioPass, ScreenedHolding } from "@/lib/types";

type SortKey = "value" | "purification" | "impure" | "symbol" | "status";

const STATUS_RANK: Record<string, number> = {
  NOT_COMPLIANT: 0,
  NEEDS_REVIEW: 1,
  UNRESOLVED: 2,
  COMPLIANT: 3,
  NOT_SCREENABLE: 4,
};

function money(n: number | null, currency: string): string {
  if (n === null) return "—";
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: currency === "MIXED" ? "CAD" : currency || "USD",
    maximumFractionDigits: 2,
  }).format(n);
}

function qty(n: number): string {
  return new Intl.NumberFormat("en-CA", { maximumFractionDigits: 4 }).format(n);
}

interface Props {
  holdings: ScreenedHolding[];
  fx: { usdToCad: number; date: string } | null;
  showCad: boolean;
}

export function HoldingsTable({ holdings, fx, showCad }: Props) {
  const [sort, setSort] = useState<SortKey>("purification");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [onlyPurification, setOnlyPurification] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const accounts = useMemo(
    () => Array.from(new Set(holdings.map((h) => h.holding.accountName).filter(Boolean))).sort(),
    [holdings],
  );

  const cur = showCad && fx ? "CAD" : "USD";
  const conv = (usd: number | null) =>
    usd === null ? null : showCad && fx ? usd * fx.usdToCad : usd;

  const rows = useMemo(() => {
    // Filter by account BEFORE grouping so "show me just my TFSA" still
    // reports the TFSA slice of an asset held in several accounts.
    const scoped =
      accountFilter === "all"
        ? holdings
        : holdings.filter((h) => h.holding.accountName === accountFilter);

    let out = groupHoldings(scoped);

    if (statusFilter !== "all") out = out.filter((g) => g.status === statusFilter);
    if (onlyPurification) {
      out = out.filter(
        (g) => (g.purificationAaoifiUsd ?? 0) > 0 || (g.purificationDividendUsd ?? 0) > 0,
      );
    }

    out.sort((a, b) => {
      switch (sort) {
        case "value":
          return Math.abs(b.totalMarketValue ?? 0) - Math.abs(a.totalMarketValue ?? 0);
        case "purification":
          return (b.purificationAaoifiUsd ?? -1) - (a.purificationAaoifiUsd ?? -1);
        case "impure":
          return (b.screen?.impureIncomePct ?? -1) - (a.screen?.impureIncomePct ?? -1);
        case "status":
          return (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
        case "symbol":
          return a.symbol.localeCompare(b.symbol);
      }
    });

    return out;
  }, [holdings, sort, statusFilter, accountFilter, onlyPurification]);

  const consolidated = holdings.length - groupHoldings(holdings).length;

  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-line)] p-4">
        <Select
          label="Sort by"
          value={sort}
          onChange={(v) => setSort(v as SortKey)}
          options={[
            ["purification", "Purification owed"],
            ["value", "Largest position"],
            ["impure", "Least compliant"],
            ["status", "Status"],
            ["symbol", "Symbol (A–Z)"],
          ]}
        />
        <Select
          label="Status"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            ["all", "All"],
            ["COMPLIANT", "Compliant"],
            ["NOT_COMPLIANT", "Not compliant"],
            ["NEEDS_REVIEW", "Needs review"],
            ["UNRESOLVED", "Unresolved"],
            ["NOT_SCREENABLE", "Not screened"],
          ]}
        />
        {accounts.length > 1 && (
          <Select
            label="Account"
            value={accountFilter}
            onChange={setAccountFilter}
            options={[["all", "All accounts"], ...accounts.map((a) => [a, a] as [string, string])]}
          />
        )}
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-[var(--color-muted)]">
          <input
            type="checkbox"
            checked={onlyPurification}
            onChange={(e) => setOnlyPurification(e.target.checked)}
            className="h-4 w-4 rounded border-[var(--color-line)]"
          />
          Only holdings needing purification
        </label>
      </div>

      {consolidated > 0 && accountFilter === "all" && (
        <div className="border-b border-[var(--color-line)] bg-[#fafbfc] px-4 py-2 text-xs text-[var(--color-muted)]">
          {rows.length} assets shown — {consolidated} duplicate position
          {consolidated === 1 ? "" : "s"} across accounts consolidated. Expand a row to see the
          per-account split.
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-line)] text-left text-xs uppercase tracking-wide text-[var(--color-muted)]">
              <th className="px-4 py-2.5 font-medium">Asset</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 text-right font-medium">Market value</th>
              <th className="px-4 py-2.5 text-right font-medium">Impure income</th>
              <th className="px-4 py-2.5 text-right font-medium">
                Purification <span className="normal-case">(AAOIFI)</span>
              </th>
              <th className="px-4 py-2.5 text-right font-medium">
                Purification <span className="normal-case">(dividend)</span>
              </th>
              <th className="w-8 px-2 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => {
              const isOpen = expanded === g.key;
              return (
                <Fragment key={g.key}>
                  <tr
                    className="cursor-pointer border-b border-[var(--color-line)] last:border-0 hover:bg-[#fafbfc]"
                    onClick={() => setExpanded(isOpen ? null : g.key)}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium">{g.symbol}</div>
                      <div className="text-xs text-[var(--color-muted)]">
                        {g.name || "—"}
                        {g.accounts.length > 1 && (
                          <> · {g.accounts.length} accounts</>
                        )}
                        {g.accounts.length === 1 && g.accounts[0].accountName && (
                          <> · {g.accounts[0].accountName}</>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        status={g.status}
                        standardsPassed={g.screen?.standardsPassed}
                        standardsTotal={g.screen?.standardsTotal}
                      />
                      {g.screen?.nonComplianceReason && (
                        <div className="mt-1 text-xs text-[var(--color-noncompliant)]">
                          {g.screen.nonComplianceReason}
                        </div>
                      )}
                      {g.statusConflict && (
                        <div className="mt-1 text-xs text-[var(--color-review)]">
                          Positions disagreed — showing the stricter verdict
                        </div>
                      )}
                    </td>
                    <td className="tnum px-4 py-3 text-right">
                      {money(g.totalMarketValue, g.currency)}
                      <div className="text-xs text-[var(--color-muted)]">
                        {qty(g.totalQuantity)} units
                      </div>
                    </td>
                    <td className="tnum px-4 py-3 text-right">
                      {g.screen?.impureIncomePct === null || g.screen?.impureIncomePct === undefined
                        ? "—"
                        : `${g.screen.impureIncomePct}%`}
                    </td>
                    <td className="tnum px-4 py-3 text-right font-medium">
                      {money(conv(g.purificationAaoifiUsd), cur)}
                    </td>
                    <td className="tnum px-4 py-3 text-right">
                      {money(conv(g.purificationDividendUsd), cur)}
                    </td>
                    <td className="px-2 py-3 text-center text-[var(--color-muted)]">
                      {isOpen ? "▾" : "▸"}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-[var(--color-line)] bg-[#fafbfc]">
                      <td colSpan={7} className="px-4 py-4">
                        <GroupDetail group={g} cur={cur} conv={conv} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>

        {rows.length === 0 && (
          <div className="p-8 text-center text-sm text-[var(--color-muted)]">
            No holdings match these filters.
          </div>
        )}
      </div>
    </div>
  );
}

function GroupDetail({
  group: g,
  cur,
  conv,
}: {
  group: GroupedHolding;
  cur: string;
  conv: (usd: number | null) => number | null;
}) {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          Assessment
        </div>
        <p className="mt-1.5 text-sm">{g.explanation || g.screen?.summary || "—"}</p>

        {g.accounts.length > 1 && (
          <div className="mt-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
              Held across {g.accounts.length} accounts
            </div>
            <table className="tnum mt-1.5 w-full text-xs">
              <tbody>
                {g.accounts.map((a) => (
                  <tr key={a.accountName} className="border-t border-[var(--color-line)]">
                    <td className="py-1">{a.accountName}</td>
                    <td className="py-1 text-right text-[var(--color-muted)]">
                      {qty(a.quantity)} units
                    </td>
                    <td className="py-1 text-right">{money(a.marketValue, a.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {g.purificationNotes.length > 0 && (
          <ul className="mt-3 space-y-1">
            {g.purificationNotes.map((n, i) => (
              <li key={i} className="text-xs text-[var(--color-muted)]">
                • {n}
              </li>
            ))}
          </ul>
        )}

        {g.zakatUsd !== null && (
          <p className="mt-3 text-xs text-[var(--color-muted)]">
            Zakat (long-term basis): {money(conv(g.zakatUsd), cur)}
          </p>
        )}

        {g.candidates && g.candidates.length > 0 && (
          <div className="mt-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
              Possible matches
            </div>
            <ul className="mt-1.5 space-y-1">
              {g.candidates.map((c, i) => (
                <li key={i} className="text-xs">
                  <a
                    className="font-medium underline"
                    href={`https://spscreener.mxcorporate.com/appstocks/${c.slug}/`}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {c.ticker}
                  </a>{" "}
                  — {c.name} <span className="text-[var(--color-muted)]">({c.exchange})</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div>
        {g.screen && g.screen.ratios.length > 0 && (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                Screening ratios by methodology
              </div>
              <div className="flex items-center gap-3 text-[11px] text-[var(--color-muted)]">
                <span className="inline-flex items-center gap-1">
                  <span className="text-[var(--color-noncompliant)]">✗</span> fails threshold
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="text-[var(--color-compliant)]">✓</span> passes
                </span>
              </div>
            </div>
            <table className="mt-1.5 w-full text-xs">
              <thead>
                <tr className="text-left text-[var(--color-muted)]">
                  <th className="py-1 font-medium">Standard</th>
                  <th className="py-1 text-right font-medium">Debt</th>
                  <th className="py-1 text-right font-medium">Non-compliant assets</th>
                  <th className="py-1 text-right font-medium">Impure income</th>
                  <th className="py-1 pl-3 text-left font-medium">Result</th>
                </tr>
              </thead>
              <tbody className="tnum">
                {g.screen.ratios.map((r) => (
                  <RatioRow key={r.methodology} ratio={r} />
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-[var(--color-muted)]">
              Thresholds differ by standard because the denominators do — AAOIFI and S&amp;P measure
              debt against market cap, FTSE and MSCI against total assets.
            </p>
          </>
        )}

        <div className="mt-3 space-y-1 text-xs">
          {g.screen?.updatedOn && (
            <p className="text-[var(--color-muted)]">
              Source data updated {g.screen.updatedOn}.
            </p>
          )}
          {g.screen?.sourceUrl && (
            <>
              <a
                href={g.screen.sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 font-medium underline"
              >
                View the full breakdown on the screener ↗
              </a>
              {/* Naming the matched listing makes the ticker resolution
                  auditable — worth showing when it differs from the broker's
                  symbol (e.g. broker "ABX" matched to the source's "ABX.TO"). */}
              <p className="text-[var(--color-muted)]">
                Matched to {g.screen.ticker}
                {g.screen.exchange ? ` on ${g.screen.exchange}` : ""} · {g.screen.companyName}
              </p>
            </>
          )}
          {g.etf?.sourceUrl && (
            <a
              href={g.etf.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 font-medium underline"
            >
              View {g.etf.provider}&rsquo;s purification data for {g.etf.ticker} ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/** Labels the ratio a cell's pass/fail mark refers to, for a readable title. */
const RATIO_CELL_LABEL: Record<"debt" | "nonCompliantAssets" | "impureIncome", string> = {
  debt: "Debt ratio",
  nonCompliantAssets: "Non-compliant assets ratio",
  impureIncome: "Impure income ratio",
};

/**
 * One ratio value with its pass/fail mark, colored so a failing number is
 * immediately visible rather than requiring a mental comparison against the
 * rulebook thresholds shown in the prose below the table.
 */
function RatioCell({
  pct,
  pass: rawPass,
  metric,
}: {
  pct: number | null;
  pass: RatioPass;
  metric: keyof typeof RATIO_CELL_LABEL;
}) {
  // Normalize anything that isn't strictly true/false to "unknown" rather than
  // letting a falsy-but-not-false value (e.g. undefined from a stale cache
  // entry predating this field) render as a false failure mark.
  const pass: RatioPass = rawPass === true ? true : rawPass === false ? false : null;

  if (pct === null && pass === null) {
    return <td className="py-1 text-right text-[var(--color-muted)]">—</td>;
  }

  const label = RATIO_CELL_LABEL[metric];
  const colorClass =
    pass === false
      ? "text-[var(--color-noncompliant)] font-semibold"
      : pass === true
        ? "text-[var(--color-compliant)]"
        : "text-[var(--color-ink)]";

  return (
    <td
      className={`py-1 text-right ${colorClass}`}
      title={
        pass === false
          ? `${label} fails this standard's threshold.`
          : pass === true
            ? `${label} passes this standard's threshold.`
            : `${label} was not separately assessed for this stock.`
      }
    >
      {pct === null ? "—" : `${pct}%`}
      {pass !== null && <span className="ml-1">{pass ? "✓" : "✗"}</span>}
    </td>
  );
}

/** One methodology's row, tinted when it fails and naming what failed. */
function RatioRow({ ratio: r }: { ratio: MethodologyRatios }) {
  const failing: string[] = [];
  if (r.debtPass === false) failing.push("Debt");
  if (r.nonCompliantAssetsPass === false) failing.push("Non-compliant assets");
  if (r.impureIncomePass === false) failing.push("Impure income");

  const rowFails = failing.length > 0;

  return (
    <tr
      className={`border-t border-[var(--color-line)] ${
        rowFails ? "bg-[var(--color-noncompliant-bg)]" : ""
      }`}
    >
      <td className="py-1 font-medium">{r.methodology}</td>
      <RatioCell pct={r.debtPct} pass={r.debtPass} metric="debt" />
      <RatioCell
        pct={r.nonCompliantAssetsPct}
        pass={r.nonCompliantAssetsPass}
        metric="nonCompliantAssets"
      />
      <RatioCell pct={r.impureIncomePct} pass={r.impureIncomePass} metric="impureIncome" />
      <td className="py-1 pl-3 text-left">
        {rowFails ? (
          <span className="text-[var(--color-noncompliant)]">Fails on {failing.join(", ")}</span>
        ) : (
          <span className="text-[var(--color-compliant)]">Passes</span>
        )}
      </td>
    </tr>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-[var(--color-muted)]">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-1.5 text-sm"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}
