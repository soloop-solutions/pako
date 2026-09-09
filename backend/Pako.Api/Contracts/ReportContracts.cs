namespace Pako.Api.Contracts;

public record ReportLine(Guid AccountId, string AccountCode, string AccountName, decimal Amount);

public record ProfitAndLossResponse(
    DateOnly From,
    DateOnly To,
    List<ReportLine> Income,
    List<ReportLine> Expenses,
    decimal TotalIncome,
    decimal TotalExpenses,
    decimal NetIncome);

public record BalanceSheetResponse(
    DateOnly AsOf,
    List<ReportLine> Assets,
    List<ReportLine> Liabilities,
    List<ReportLine> Equity,
    decimal CurrentEarnings,
    decimal TotalAssets,
    decimal TotalLiabilities,
    decimal TotalEquity);

public record VatReturnLine(Guid TaxDefinitionId, string Name, decimal Rate, decimal Amount);

public record VatReturnResponse(
    DateOnly From,
    DateOnly To,
    List<VatReturnLine> OutputVat,
    List<VatReturnLine> InputVat,
    decimal TotalOutputVat,
    decimal TotalInputVat,
    decimal NetVatDue);

// 60_Posting_Rules R20/R21: R20 (NON) is a full add-back, no rule reference needed. R21 (LIMIT)
// needs the account's CitLimitRule note attached — evaluating the actual annual cap ("1% of
// gross income" etc.) is a year-end computation this report doesn't attempt; it flags the
// candidate amounts and their rule text for an accountant to apply the cap to.
public record CitLimitFlaggedLine(Guid AccountId, string AccountCode, string AccountName, decimal Amount, string? LimitRule);

public record CitAddBackResponse(
    DateOnly From,
    DateOnly To,
    List<ReportLine> NonDeductible,
    List<CitLimitFlaggedLine> LimitFlagged,
    decimal TotalNonDeductible,
    decimal TotalLimitFlagged);

// C6: an unpaid invoice is outstanding the moment it posts, but it isn't "debt" (borxh) until the
// agreed due date plus its own grace period has passed — Bucket is "Current" (not yet due),
// "WithinGrace" (past due, still within grace) or "Overdue" (the actual debt list).
public record DebtAgingLine(
    Guid InvoiceId,
    string? InvoiceNumber,
    Guid PartnerId,
    DateOnly IssueDate,
    DateOnly DueDate,
    int? GraceDays,
    decimal Outstanding,
    string Bucket);

public record DebtAgingResponse(
    DateOnly AsOf,
    List<DebtAgingLine> Lines,
    decimal TotalCurrent,
    decimal TotalWithinGrace,
    decimal TotalOverdue);
