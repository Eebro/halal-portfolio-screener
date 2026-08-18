/**
 * Parser for Wealthsimple's "holdings report" CSV export.
 *
 * Shape confirmed against a real export (21 columns, all fields quoted):
 *   Account Name, Account Type, Account Classification, Account Number,
 *   Symbol, Exchange, MIC, Name, Security Type, Quantity, Position Direction,
 *   Market Price, Market Price Currency, Book Value (CAD),
 *   Book Value Currency (CAD), Book Value (Market),
 *   Book Value Currency (Market), Market Value, Market Value Currency,
 *   Market Unrealized Returns, Market Unrealized Returns Currency
 *
 * Two quirks the file actually has:
 *  - it ends with a blank line followed by a lone `"As of <timestamp>"` row
 *  - `Symbol` suffixes are inconsistent *within one file*: `ABX` and `AEM.TO`
 *    are both XTSE, but only one carries `.TO`
 *
 * Account Number is deliberately NOT retained — it is sensitive and nothing
 * downstream needs it.
 */
import type { Holding, SecurityType } from "@/lib/types";

const KNOWN_SECURITY_TYPES: SecurityType[] = [
  "EQUITY",
  "EXCHANGE_TRADED_FUND",
  "CURRENCY",
  "CRYPTOCURRENCY",
  "PRECIOUS_METAL",
];

export interface CsvParseResult {
  holdings: Holding[];
  /** e.g. "2026-08-18 13:48 GMT-04:00", taken from the trailing footer row. */
  asOf: string | null;
  /** Non-fatal problems worth surfacing rather than swallowing. */
  warnings: string[];
}

/**
 * Minimal RFC 4180 parser. Handles quoted fields, embedded commas, escaped
 * quotes (`""`) and both CRLF and LF line endings.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += ch;
    i++;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Parses a possibly-empty numeric cell. Returns null rather than 0 for blanks
 * so callers can distinguish "no data" from "genuinely zero".
 */
function num(v: string | undefined): number | null {
  if (v === undefined) return null;
  const s = v.trim();
  if (s === "" || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

export function parseWealthsimpleCsv(text: string): CsvParseResult {
  const warnings: string[] = [];
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ""));

  if (rows.length === 0) {
    return { holdings: [], asOf: null, warnings: ["File is empty."] };
  }

  // The export ends with a lone `"As of ..."` row after a blank line. It has
  // far fewer columns than the header, which is how we recognize it.
  let asOf: string | null = null;
  const last = rows[rows.length - 1];
  if (last.length < 5 && /as of/i.test(last[0] ?? "")) {
    asOf = (last[0] ?? "").replace(/^\s*as of\s*/i, "").trim();
    rows.pop();
  }

  const header = rows[0].map(normalizeHeader);
  const col = (name: string): number => header.indexOf(normalizeHeader(name));

  const idx = {
    accountName: col("Account Name"),
    accountType: col("Account Type"),
    symbol: col("Symbol"),
    exchange: col("Exchange"),
    mic: col("MIC"),
    name: col("Name"),
    securityType: col("Security Type"),
    quantity: col("Quantity"),
    direction: col("Position Direction"),
    marketPrice: col("Market Price"),
    marketPriceCurrency: col("Market Price Currency"),
    bookValueCad: col("Book Value (CAD)"),
    marketValue: col("Market Value"),
    marketValueCurrency: col("Market Value Currency"),
  };

  const required: (keyof typeof idx)[] = ["symbol", "securityType", "quantity"];
  const missing = required.filter((k) => idx[k] === -1);
  if (missing.length > 0) {
    return {
      holdings: [],
      asOf,
      warnings: [
        `This does not look like a Wealthsimple holdings export — missing column(s): ${missing.join(", ")}.`,
      ],
    };
  }

  const holdings: Holding[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const symbol = (cells[idx.symbol] ?? "").trim();
    if (!symbol) continue;

    const rawType = (cells[idx.securityType] ?? "").trim().toUpperCase();
    let securityType: SecurityType;
    if ((KNOWN_SECURITY_TYPES as string[]).includes(rawType)) {
      securityType = rawType as SecurityType;
    } else {
      // Don't guess: treat unknown asset classes as equity-like but warn, so a
      // new Wealthsimple type shows up loudly instead of being dropped.
      securityType = "EQUITY";
      warnings.push(
        `Row ${r + 1} (${symbol}): unrecognized Security Type "${rawType}" — treated as EQUITY.`,
      );
    }

    const quantity = num(cells[idx.quantity]) ?? 0;
    const direction = (cells[idx.direction] ?? "LONG").trim().toUpperCase();
    if (direction && direction !== "LONG") {
      warnings.push(
        `Row ${r + 1} (${symbol}): position direction is ${direction}; purification for non-long positions is not modelled.`,
      );
    }

    holdings.push({
      symbol,
      name: (cells[idx.name] ?? "").trim(),
      securityType,
      mic: (cells[idx.mic] ?? "").trim().toUpperCase(),
      exchange: (cells[idx.exchange] ?? "").trim(),
      quantity,
      direction,
      marketPrice: num(cells[idx.marketPrice]) ?? 0,
      marketPriceCurrency: (cells[idx.marketPriceCurrency] ?? "").trim().toUpperCase(),
      marketValue: num(cells[idx.marketValue]) ?? 0,
      marketValueCurrency: (cells[idx.marketValueCurrency] ?? "").trim().toUpperCase(),
      bookValueCad: num(cells[idx.bookValueCad]),
      accountName: (cells[idx.accountName] ?? "").trim(),
      accountType: (cells[idx.accountType] ?? "").trim(),
    });
  }

  if (holdings.length === 0) warnings.push("No holdings rows found.");
  return { holdings, asOf, warnings };
}
