import type { ComplianceStatus } from "@/lib/types";

const STYLES: Record<ComplianceStatus, { label: string; className: string }> = {
  COMPLIANT: {
    label: "Compliant",
    className: "bg-[var(--color-compliant-bg)] text-[var(--color-compliant)]",
  },
  NOT_COMPLIANT: {
    label: "Not compliant",
    className: "bg-[var(--color-noncompliant-bg)] text-[var(--color-noncompliant)]",
  },
  NEEDS_REVIEW: {
    label: "Needs review",
    className: "bg-[var(--color-review-bg)] text-[var(--color-review)]",
  },
  UNRESOLVED: {
    label: "Unresolved",
    className: "bg-[var(--color-review-bg)] text-[var(--color-review)]",
  },
  NOT_SCREENABLE: {
    label: "Not screened",
    className: "bg-[var(--color-neutral-chip-bg)] text-[var(--color-neutral-chip)]",
  },
};

interface Props {
  status: ComplianceStatus;
  standardsPassed?: number | null;
  standardsTotal?: number | null;
}

/**
 * The standards count is shown inline rather than hidden behind the expander.
 *
 * The headline verdict tracks the primary (AAOIFI) standard, so a holding can
 * read "Compliant" while passing only 1 of 5 — Camden Property Trust is 1/5,
 * PepsiCo is 3/5. The badge alone would overstate how settled that is, so a
 * partial pass is tinted amber to invite a closer look without contradicting
 * the source's verdict.
 */
export function StatusBadge({ status, standardsPassed, standardsTotal }: Props) {
  const s = STYLES[status];
  const hasCount =
    typeof standardsPassed === "number" && typeof standardsTotal === "number" && standardsTotal > 0;
  const partial = hasCount && standardsPassed < standardsTotal;

  return (
    <div className="flex flex-col items-start gap-1">
      <span
        className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${s.className}`}
      >
        {s.label}
      </span>
      {hasCount && (
        <span
          className={`tnum text-[11px] font-medium ${
            partial ? "text-[var(--color-review)]" : "text-[var(--color-muted)]"
          }`}
          title={
            partial
              ? `Passes ${standardsPassed} of ${standardsTotal} screening standards. The headline verdict follows the primary standard; the others differ mainly in their denominators.`
              : `Passes all ${standardsTotal} screening standards.`
          }
        >
          {standardsPassed}/{standardsTotal} standards
        </span>
      )}
    </div>
  );
}
