import { describe, it, expect } from "vitest";
import { classifyAccountType } from "@/lib/tax/accountType";

describe("classifyAccountType", () => {
  it("classifies clean CSV-style account types", () => {
    expect(classifyAccountType({ accountType: "TFSA", accountName: "TFSA" })).toBe("TFSA");
    expect(classifyAccountType({ accountType: "RRSP", accountName: "RRSP" })).toBe("RRSP");
    expect(classifyAccountType({ accountType: "FHSA", accountName: "FHSA" })).toBe("FHSA");
    expect(
      classifyAccountType({ accountType: "Non-registered", accountName: "Non-registered" }),
    ).toBe("NON_REGISTERED");
  });

  it("classifies noisier SnapTrade-style account names", () => {
    // Confirmed against a real connected Wealthsimple account via SnapTrade —
    // the institution name is prepended to the account type.
    expect(classifyAccountType({ accountType: "", accountName: "Wealthsimple Trade TFSA" })).toBe(
      "TFSA",
    );
    expect(classifyAccountType({ accountType: "", accountName: "Wealthsimple Trade FHSA" })).toBe(
      "FHSA",
    );
    expect(classifyAccountType({ accountType: "", accountName: "Wealthsimple Trade RRSP" })).toBe(
      "RRSP",
    );
    expect(
      classifyAccountType({ accountType: "", accountName: "Wealthsimple Trade PERSONAL" }),
    ).toBe("NON_REGISTERED");
  });

  it("does not let RRSP shadow FHSA or TFSA when checked as substrings", () => {
    // A naive "contains RRSP" style check must not fire on an FHSA/TFSA label.
    expect(classifyAccountType({ accountType: "FHSA", accountName: "FHSA" })).toBe("FHSA");
    expect(classifyAccountType({ accountType: "TFSA", accountName: "TFSA" })).toBe("TFSA");
  });

  it("recognizes common non-registered synonyms", () => {
    expect(classifyAccountType({ accountType: "Individual", accountName: "Individual" })).toBe(
      "NON_REGISTERED",
    );
    expect(classifyAccountType({ accountType: "Margin", accountName: "Margin" })).toBe(
      "NON_REGISTERED",
    );
  });

  it("defaults unrecognized labels to OTHER rather than guessing a tax-advantaged status", () => {
    // This is the safe direction: never silently assume something is
    // tax-sheltered when it isn't confirmed, which would understate zakat.
    expect(classifyAccountType({ accountType: "Crypto", accountName: "Crypto" })).toBe("OTHER");
    expect(classifyAccountType({ accountType: "", accountName: "Something Unknown" })).toBe(
      "OTHER",
    );
  });

  it("is case-insensitive", () => {
    expect(classifyAccountType({ accountType: "tfsa", accountName: "tfsa" })).toBe("TFSA");
    expect(classifyAccountType({ accountType: "rrsp", accountName: "rrsp" })).toBe("RRSP");
  });
});
