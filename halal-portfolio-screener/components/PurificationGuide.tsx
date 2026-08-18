"use client";

import { useState } from "react";

/**
 * Explains purification timing.
 *
 * Deliberately descriptive, not prescriptive: it reports what the named
 * standards require and is explicit that scholars differ, rather than issuing
 * a ruling. Every claim here traces to a linked primary source — AAOIFI SS-21
 * is the standard the app's data is built on, so it is cited first.
 */

interface Timing {
  title: string;
  cadence: string;
  body: string;
  applies: string;
}

const TIMINGS: Timing[] = [
  {
    title: "AAOIFI — every financial period",
    cadence: "Quarterly",
    body: "The standard the screener's figures are built on treats purification as due each financial period, whether or not the company paid you anything. The per-share amount shown in the table is one period's obligation, which is why this app reports it as the current period and does not multiply it out to a year.",
    applies: "Applies to every holding you own during the period.",
  },
  {
    title: "S&P Shariah — when a dividend arrives",
    cadence: "Per dividend",
    body: "A narrower view: purify only the tainted share of income you actually received, by removing the impure-income percentage from each dividend. On this view a company that pays no dividend creates nothing to purify.",
    applies: "Applies only to dividend-paying holdings.",
  },
  {
    title: "Zakat — once a lunar year",
    cadence: "Annually",
    body: "Distinct from purification and owed in addition to it. If you hold shares as trading goods rather than for long-term income, the common treatment is 2.5% of market value once a lunar year (hawl) has passed over them. Long-term holdings are usually assessed differently, which is the per-share zakat figure shown in each expanded row.",
    applies: "Applies to the whole portfolio, including cash and gold.",
  },
];

/**
 * Exported so the link set can be asserted in tests. A dead or mistyped source
 * link is worse than none here — the whole point is that a reader can check the
 * claim against the standard itself.
 *
 * Deliberately omitted: the screener cites an MSCI Islamic Indexes page that
 * currently 404s, so it is not reproduced.
 */
export const SOURCES: { label: string; note: string; href: string }[] = [
  {
    label: "AAOIFI Shari'ah Standard No. 21 — Financial Paper (Shares and Bonds)",
    note: "The primary standard behind the screening ratios and per-share purification figures used here.",
    href: "https://aaoifi.com/ss-21-financial-paper-shares-and-bonds/?lang=en",
  },
  {
    label: "S&P Dow Jones Indices — Shariah Indices Methodology",
    note: "Sets out the dividend-only purification approach and the ratio thresholds behind the S&P column.",
    href: "https://www.spglobal.com/spdji/en/documents/methodologies/methodology-sp-shariah-indices.pdf",
  },
  {
    label: "FTSE Russell — Global Shariah index series",
    note: "Screens against total assets rather than market cap, which is why its ratios differ.",
    href: "https://www.lseg.com/en/ftse-russell/indices/global-shariah",
  },
  {
    label: "SP Funds — purification calculator and quarterly fund rates",
    note: "Source of this app's stock data and of the published ETF purification rates.",
    href: "https://www.sp-funds.com/purification-calculator/",
  },
];

export function PurificationGuide() {
  const [open, setOpen] = useState(false);

  return (
    <section className="rounded-xl border border-[var(--color-line)] bg-white shadow-sm">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-3 p-5 text-left"
      >
        <div>
          <h2 className="text-sm font-semibold">How often should you purify?</h2>
          <p className="mt-0.5 text-xs text-[var(--color-muted)]">
            The standards disagree on timing. Here is what each one actually requires, with sources.
          </p>
        </div>
        <span className="shrink-0 text-[var(--color-muted)]">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="border-t border-[var(--color-line)] p-5">
          <div className="grid gap-4 md:grid-cols-3">
            {TIMINGS.map((t) => (
              <div
                key={t.title}
                className="rounded-lg border border-[var(--color-line)] bg-[#fafbfc] p-4"
              >
                <div className="inline-flex rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-[var(--color-muted)] ring-1 ring-[var(--color-line)]">
                  {t.cadence}
                </div>
                <h3 className="mt-2 text-sm font-semibold">{t.title}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-muted)]">{t.body}</p>
                <p className="mt-2 text-xs font-medium">{t.applies}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 rounded-lg border border-[var(--color-review)] bg-[var(--color-review-bg)] p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-review)]">
              Where scholars genuinely differ
            </p>
            <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-[var(--color-review)]">
              <li>
                • <strong>Frequency.</strong> Every financial period, annually, or only when income
                is received — the standards above take different positions.
              </li>
              <li>
                • <strong>Capital gains.</strong> Whether the gain on sale needs purifying at all,
                or only dividend income, is disputed.
              </li>
              <li>
                • <strong>Basis.</strong> Whether to purify a share of total revenue or only the
                income you personally received.
              </li>
            </ul>
            <p className="mt-2.5 text-xs text-[var(--color-review)]">
              This app computes both the per-period and dividend-only figures so you can follow
              whichever position you hold to. It does not rule between them.
            </p>
          </div>

          <div className="mt-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
              Primary sources
            </p>
            <ul className="mt-2 space-y-2.5">
              {SOURCES.map((s) => (
                <li key={s.href}>
                  <a
                    href={s.href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-xs font-medium underline"
                  >
                    {s.label} ↗
                  </a>
                  <p className="mt-0.5 text-xs text-[var(--color-muted)]">{s.note}</p>
                </li>
              ))}
            </ul>
          </div>

          <p className="mt-5 text-xs leading-relaxed text-[var(--color-muted)]">
            These are standard-setting bodies and index providers, not a substitute for a scholar
            who knows your circumstances. Purification is a question of fiqh, and reasonable,
            qualified people reach different conclusions on it.
          </p>
        </div>
      )}
    </section>
  );
}
