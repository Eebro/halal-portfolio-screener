# Halal Portfolio Screener

Upload a brokerage holdings export (or connect an account) and get every position screened for Shariah compliance, with the dollar purification owed per holding and portfolio-wide.

```bash
npm install
npm run build:index   # ~1 min, builds the 20.5k-ticker screener index
npm run build:etfs    # scrapes current ETF purification rates
npm run dev           # http://localhost:3100
```

Click **Try sample data** to see it working immediately — no credentials needed.

## How it works

```
scripts/build-index.ts  ──(one-time)──▶  data/screener-index.json  (20,534 tickers)
scripts/build-etfs.ts   ────────────▶    data/etf-registry.json

CSV upload ────┐
               ├─▶ asset router ─┬─▶ stock screener (resolve → fetch detail → cache)
SnapTrade  ────┘                 ├─▶ ETF registry
                                 ├─▶ cash (neutral)
                                 └─▶ crypto / metal (informational, no verdict)
                                              │
                                              ▼
                                    purification math ─▶ dashboard
```

### Data source

Stock compliance data comes from the [SP Funds / ShariaPortfolio screener](https://www.sp-funds.com/stock-screener/). That page iframes `spscreener.mxcorporate.com`, a WordPress site whose stock records are exposed through an unauthenticated public WP REST API. Each record carries a verdict, impure-income percentage, per-share purification and zakat figures, and ratios against five methodologies (AAOIFI, S&P, DJIM, FTSE, MSCI).

This is an **undocumented endpoint**. We cache hard, identify ourselves in the User-Agent, and keep golden fixtures so a redesign fails loudly in CI rather than silently producing wrong numbers. For anything beyond a hackday, [Zoya's official API](https://zoya.finance/api) is the productionization path.

### Why a build-time index

The upstream `?search=` endpoint ranks by relevance, and short tickers get buried — `SU`, `TRI` and `AG` all return nothing useful when searched by ticker despite existing in the dataset. Exact matching over a complete local index is the only way to resolve them correctly, and it makes scans fast (one network call per held ticker instead of two).

## Things that are less obvious than they look

**Tickers collide, and collisions flip verdicts.**

```
ABX  The Toronto Stock Exchange  COMPLIANT      Barrick Mining Corp
ABX  NYSE                        NOT-COMPLIANT  Abacus Global Management Inc

CCO  The Toronto Stock Exchange  COMPLIANT      Cameco Corp
CCO  NYSE                        NOT-COMPLIANT  Clear Channel Outdoor Holdings Inc
```

Resolution matches on exchange (via the CSV's `MIC` column) **and** company name. When the evidence is ambiguous, or the source self-contradicts, the holding is surfaced as unresolved with candidate matches rather than guessed.

**A brokerage export is not a list of stocks.** A real Wealthsimple file mixes equities, ETFs, cash, crypto and physically-backed metal. Each routes differently — and the stock screener has **zero ETF coverage**, so funds are matched against a curated registry instead. Anything unrecognized renders "needs review", never an assumed verdict.

**Ticker suffixes are inconsistent within a single file.** `ABX` and `AEM.TO` are both XTSE, but only one carries `.TO`.

**Currencies must be normalized before aggregating.** Purification publishes in USD per share while most Canadian positions are valued in CAD. Summing them raw skews the compliance percentage; the scan converts to CAD first and says so when no FX rate is available.

**`-` is not `0`.** Non-compliant pages render `-` for impure income and zakat. Parsing that as zero would read as "nothing to purify" — the opposite of the truth. It parses to `null` throughout.

**"Compliant" does not mean it passed everything.** The headline verdict follows the primary (AAOIFI) standard, so a holding can read *Compliant* while passing as few as 1 of 5 screened standards — Camden Property Trust is 1/5, PepsiCo is 3/5. The count is shown inline on the status badge, tinted amber on a partial pass, so the badge alone never overstates how settled the verdict is.

**The same asset appears once per account.** A real export lists WSHR, AEM.TO and SPUS three times each. Positions are consolidated into one row per asset, keyed on normalized ticker *plus* name — so `ABX` and `ABX.TO` merge, but Barrick and Abacus Global (who share the ticker) never do. Expand a row for the per-account split.

## Purification

Two bases, computed side by side because they answer different questions:

| Basis | Formula | Notes |
|---|---|---|
| AAOIFI | `purification per share × quantity` | Owed **every financial period** (quarterly), dividend or not. Reported for the current period, deliberately **not** annualized. |
| Dividend-based (S&P) | `impure income % × dividends received` | Nothing owed on a non-dividend payer. Needs dividend data, which a CSV export lacks. |
| ETFs | `fund's quarterly rate × dividends received` | From `data/etf-registry.json`. SPSK is 0 — sukuk are compliant by definition. |

Zakat is also published per share and surfaced alongside.

### Timing

The app ships a **"How often should you purify?"** panel covering the three cadences and, importantly, naming where scholars genuinely disagree — frequency, whether capital gains need purifying at all, and whether the basis is total revenue or income personally received. It reports what each standard requires and does not rule between them.

Every claim links to a primary source: [AAOIFI Shari'ah Standard No. 21](https://aaoifi.com/ss-21-financial-paper-shares-and-bonds/?lang=en) (the standard this app's figures are built on), the [S&P Dow Jones Shariah methodology](https://www.spglobal.com/spdji/en/documents/methodologies/methodology-sp-shariah-indices.pdf), [FTSE Russell Global Shariah](https://www.lseg.com/en/ftse-russell/indices/global-shariah), and the [SP Funds purification calculator](https://www.sp-funds.com/purification-calculator/).

Link rot is guarded by `tests/sources.test.ts`. Structural checks run offline; verify the links actually resolve with:

```bash
CHECK_LINKS=1 npx vitest run tests/sources.test.ts
```

## Connecting a brokerage (optional)

Wealthsimple has no public API. [SnapTrade](https://snaptrade.com) covers both Wealthsimple and Questrade on a free Personal tier.

1. Create a Personal account at [snaptrade.com](https://snaptrade.com) and verify your email.
2. Generate a Personal API key in the dashboard.
3. Add to `.env.local`:

```
SNAPTRADE_CLIENT_ID=your_client_id
SNAPTRADE_CONSUMER_KEY=your_consumer_key
```

The brokerage option only appears in the UI once these are set.

> **The free Personal tier is scoped to your own accounts.** Other people cannot connect theirs, which is why CSV upload is a first-class path rather than a fallback — it is what makes the app demoable to anyone.

The SnapTrade network calls are **untested** (they need live credentials); the payload-normalization layer is unit-tested.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on :3100 |
| `npm run build:index` | Rebuild the ticker index (~1 min). Re-run quarterly. |
| `npm run build:etfs` | Refresh ETF purification rates |
| `npm run fixtures` | Re-download golden fixture pages |
| `npm test` | Full suite (128 tests) |
| `CHECK_LINKS=1 npx vitest run tests/sources.test.ts` | Verify cited sources still resolve |
| `npx tsx scripts/smoke.ts` | Live end-to-end scan against the sample CSV |

## Privacy

Uploaded CSVs are parsed in memory and never written to disk or logged. The account number column is dropped at parse time. Screener detail pages are cached under `.cache/` (gitignored); no portfolio data is cached.

## Limitations

- Compliance data is a periodic snapshot (~quarterly), not live. The source's "Updated on" date is shown in the UI.
- ETFs rely on a small curated registry, not a screen.
- CSE (`XCNQ`) and Cboe Canada (`NEOE`) listings are not in the source's 12 exchanges and resolve as unresolved.
- Dividend-based purification needs dividend figures the CSV does not carry.

**This is not a fatwa.** It is an informational tool built on third-party data. Cryptocurrency in particular is genuinely contested and this app deliberately asserts no verdict on it. Consult a qualified scholar.
