using Pako.Domain.Invoicing;
using Pako.Domain.Payroll;

namespace Pako.Api.Contracts;

// ---- G10 salary advances and loans ----

public record CreateEmployeeLoanRequest(
    Guid EmployeeId,
    EmployeeLoanKind Kind,
    decimal Principal,
    DateOnly IssuedOn,
    decimal InstallmentAmount,
    // Any day of the first month payroll recovers it.
    DateOnly FirstPeriod,
    Guid CashOrBankAccountId,
    string? Notes);

public record LoanRepaymentResponse(Guid AdjustmentId, Guid PayrollRunId, DateOnly Period, decimal Amount, string RunState);

public record EmployeeLoanResponse(
    Guid Id,
    Guid EmployeeId,
    string EmployeeName,
    EmployeeLoanKind Kind,
    decimal Principal,
    DateOnly IssuedOn,
    decimal InstallmentAmount,
    DateOnly FirstPeriod,
    string State,
    // Recovered by posted runs; Outstanding = Principal − RepaidPosted. InDraftRuns is held by runs
    // not posted yet.
    decimal RepaidPosted,
    decimal InDraftRuns,
    decimal Outstanding,
    Guid? DisbursementJournalEntryId,
    string? Notes,
    List<LoanRepaymentResponse> Repayments);

// ---- G11 commission ----

public record SaveCommissionPlanRequest(string Name, CommissionBasis Basis, decimal Rate, decimal? MinThreshold, bool IsActive = true);

public record CommissionPlanResponse(Guid Id, string Name, CommissionBasis Basis, decimal Rate, decimal? MinThreshold, bool IsActive, int EmployeeCount);

public record CalculateCommissionsRequest(DateOnly Period);

public record CommissionResultResponse(
    Guid EmployeeId,
    string EmployeeName,
    string PlanName,
    decimal Basis,
    decimal Amount,
    // True when a payroll run already used this month's commission: it was left unchanged.
    bool Locked,
    Guid? AdjustmentId);

// One document behind a commission. InvoiceNet is the document's net (negative for a credit note
// or return); CountedAmount is what entered the basis (the net, or the paid share of it).
public record CommissionBasisItemResponse(
    Guid InvoiceId,
    string? InvoiceNumber,
    DateOnly IssueDate,
    Guid PartnerId,
    string PartnerName,
    DocumentType DocumentType,
    decimal InvoiceNet,
    decimal CountedAmount,
    DateOnly? PaidOn);

// ---- I14 firm payroll dashboard ----

public record FirmPayrollCompanyResponse(
    Guid CompanyId,
    string CompanyName,
    // Null when no run exists for the month; otherwise Draft, Approved, Posted or Paid.
    Guid? RunId,
    string? RunState,
    int EmployeeCount,
    decimal? TotalGross,
    DateOnly EdiDueDate,
    int DaysRemaining,
    // Done (posted or paid), Overdue, DueSoon (≤ 5 days and not posted) or Open.
    string Status);

public record FirmPayrollOverviewResponse(Guid FirmId, string FirmName, DateOnly Month, List<FirmPayrollCompanyResponse> Companies);
