import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useIntl } from "react-intl";
import type { PayslipDetailResponse } from "@pako/shared";

import { cn } from "@/lib/utils";
import {
  formatAmount,
  formatPayrollMonth,
  isDeductionKind,
  isHourBasedKind,
  PayrollAdjustmentKind,
  payrollAdjustmentKindLabel,
} from "@/lib/payroll-enums";

type PayslipProps = {
  companyName: string;
  periodStart: string;
  periodEnd: string;
  line: PayslipDetailResponse;
  className?: string;
};

function Row({ label, value, strong, indent, muted }: { label: ReactNode; value: ReactNode; strong?: boolean; indent?: boolean; muted?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-4 border-b border-dashed border-border py-1 last:border-b-0",
        strong && "font-semibold",
        muted && "text-muted-foreground",
      )}
    >
      <span className={cn(indent && "pl-4")}>{label}</span>
      <span className="text-right tabular-nums whitespace-nowrap">{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <h4 className="mb-1 border-b border-foreground/60 pb-0.5 text-[11px] font-semibold tracking-wide uppercase">{title}</h4>
      {children}
    </div>
  );
}

// One employee's payslip (fletëpagesa). Every figure is the API's own — base, additions, gross,
// pension, PIT, deductions and net are rendered as returned; nothing is derived here. The PIT
// base (gross less employee pension) is not in PayslipDetailResponse, so it is described in the
// PIT label rather than shown as a number.
export function Payslip({ companyName, periodStart, periodEnd, line, className }: PayslipProps) {
  const intl = useIntl();
  const money = (value: number) => formatAmount(value);
  // Reimbursements are not earnings: they are listed on their own, outside gross.
  const additions = line.adjustments.filter((a) => !isDeductionKind(a.kind) && a.kind !== PayrollAdjustmentKind.Reimbursement);
  const deductions = line.adjustments.filter((a) => isDeductionKind(a.kind));

  function adjustmentLabel(kind: number, description: string | undefined, hours: number | undefined, multiplier: number | undefined) {
    const parts = [payrollAdjustmentKindLabel(kind, intl)];
    if (description) parts.push(description);
    let label = parts.join(" — ");
    if (isHourBasedKind(kind) && typeof hours === "number") {
      label += ` (${intl.formatMessage(
        { id: "payroll.payslip.hoursTimes" },
        {
          hours: intl.formatNumber(hours, { maximumFractionDigits: 2 }),
          multiplier: intl.formatNumber(multiplier ?? 1, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        },
      )})`;
    }
    return label;
  }

  return (
    <article className={cn("flex flex-col gap-4 text-[12.5px]", className)} aria-label={intl.formatMessage({ id: "payroll.payslip.title" })}>
      <header className="flex items-start justify-between gap-4 border-b-2 border-foreground pb-2">
        <div>
          <p className="text-base font-semibold">{companyName}</p>
          <p className="text-xs text-muted-foreground">
            {periodStart} – {periodEnd}
          </p>
        </div>
        <div className="text-right">
          <p className="text-base font-semibold">{intl.formatMessage({ id: "payroll.payslip.title" })}</p>
          <p className="text-xs">{formatPayrollMonth(periodStart, intl)}</p>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-x-6 gap-y-1">
        <Row label={intl.formatMessage({ id: "payroll.payslip.employee" })} value={line.employeeName} strong />
        <Row label={intl.formatMessage({ id: "payroll.payslip.personalNumber" })} value={line.personalNumber || "—"} />
        <Row label={intl.formatMessage({ id: "payroll.payslip.department" })} value={line.departmentName || "—"} />
        <Row
          label={intl.formatMessage({ id: "payroll.payslip.employerType" })}
          value={intl.formatMessage({ id: line.isPrimaryEmployer ? "payroll.payslip.primaryEmployer" : "payroll.payslip.secondaryEmployer" })}
        />
      </div>

      <Section title={intl.formatMessage({ id: "payroll.payslip.earnings" })}>
        <Row label={intl.formatMessage({ id: "payroll.payslip.baseSalary" })} value={money(line.baseSalary)} />
        <Row
          label={intl.formatMessage({ id: "payroll.payslip.days" })}
          value={intl.formatMessage({ id: "payroll.payslip.daysValue" }, { paid: line.paidDays, working: line.workingDays })}
          muted
        />
        {additions.map((a) => (
          <Row key={a.id} indent label={adjustmentLabel(a.kind, a.description, a.hours, a.rateMultiplier)} value={money(a.amount)} />
        ))}
        <Row label={intl.formatMessage({ id: "payroll.payslip.bonuses" })} value={money(line.bonusAmount)} />
        <Row label={intl.formatMessage({ id: "payroll.payslip.otherAdditions" })} value={money(line.otherAdditionsAmount)} />
        <Row label={intl.formatMessage({ id: "payroll.payslip.gross" })} value={money(line.grossSalary)} strong />
      </Section>

      <Section title={intl.formatMessage({ id: "payroll.payslip.withholdings" })}>
        <Row
          label={intl.formatMessage({
            id: line.employeePensionAmount !== 0 ? "payroll.payslip.employeePensionRate" : "payroll.payslip.employeePension",
          })}
          value={money(line.employeePensionAmount)}
        />
        <Row
          label={intl.formatMessage({ id: line.isPrimaryEmployer ? "payroll.payslip.pitPrimary" : "payroll.payslip.pitSecondary" })}
          value={money(line.pitAmount)}
        />
        {deductions.map((a) => (
          <Row key={a.id} indent label={adjustmentLabel(a.kind, a.description, a.hours, a.rateMultiplier)} value={money(a.amount)} />
        ))}
        <Row label={intl.formatMessage({ id: "payroll.payslip.deductions" })} value={money(line.deductionsAmount)} />
        {(line.loanRepaymentAmount ?? 0) !== 0 && (
          <Row indent muted label={intl.formatMessage({ id: "payroll.payslip.loanRepayments" })} value={money(line.loanRepaymentAmount ?? 0)} />
        )}
      </Section>

      {(line.reimbursementAmount ?? 0) !== 0 && (
        <Section title={intl.formatMessage({ id: "payroll.payslip.reimbursements" })}>
          <Row label={intl.formatMessage({ id: "payroll.payslip.reimbursements" })} value={money(line.reimbursementAmount ?? 0)} />
        </Section>
      )}

      <div className="flex items-baseline justify-between border-y-2 border-foreground py-1.5 text-sm font-semibold">
        <span>{intl.formatMessage({ id: "payroll.payslip.netPay" })}</span>
        <span className="tabular-nums">{money(line.netPay)}</span>
      </div>

      <Section title={intl.formatMessage({ id: "payroll.payslip.employerContributions" })}>
        <Row
          label={intl.formatMessage({
            id: line.employerPensionAmount !== 0 ? "payroll.payslip.employerPensionRate" : "payroll.payslip.employerPension",
          })}
          value={money(line.employerPensionAmount)}
          muted
        />
      </Section>

      <footer className="mt-6 grid grid-cols-2 gap-10 text-xs text-muted-foreground">
        <div className="border-t border-foreground/60 pt-1">{intl.formatMessage({ id: "payroll.payslip.employerSignature" })}</div>
        <div className="border-t border-foreground/60 pt-1">{intl.formatMessage({ id: "payroll.payslip.employeeSignature" })}</div>
      </footer>
    </article>
  );
}

const PRINT_ROOT_CLASS = "pako-payslip-print";

// While mounted, printing shows only these payslips (one per A4 page) and hides the app shell.
// Mounted just for the duration of window.print() by PayrollRunDetail — the stylesheet lives
// here, not in index.css, so it never affects printing any other screen.
export function PayslipPrintPortal({
  companyName,
  periodStart,
  periodEnd,
  lines,
}: {
  companyName: string;
  periodStart: string;
  periodEnd: string;
  lines: PayslipDetailResponse[];
}) {
  return createPortal(
    <div className={PRINT_ROOT_CLASS} data-testid="payslip-print-root">
      <style>{`
@media screen { .${PRINT_ROOT_CLASS} { display: none; } }
@media print {
  @page { size: A4; margin: 14mm; }
  body > *:not(.${PRINT_ROOT_CLASS}) { display: none !important; }
  .${PRINT_ROOT_CLASS} { display: block; background: #fff; color: #000; }
  .${PRINT_ROOT_CLASS} .pako-payslip-page { break-after: page; page-break-after: always; }
  .${PRINT_ROOT_CLASS} .pako-payslip-page:last-child { break-after: auto; page-break-after: auto; }
}
`}</style>
      {lines.map((line) => (
        <div key={line.id} className="pako-payslip-page">
          <Payslip companyName={companyName} periodStart={periodStart} periodEnd={periodEnd} line={line} />
        </div>
      ))}
    </div>,
    document.body,
  );
}
