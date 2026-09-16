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

// B10: one row per (posted document, VAT code) — the finest granularity a book needs, since a
// single invoice/bill can carry lines at more than one rate. DocumentType is carried through
// rather than filtered on: whatever actually posted with a Shitje/Blerje*-book VAT code belongs
// in the book, no hardcoded document-type list to go stale. This also means a SalesReturn shows
// up exactly like a CreditNote does — same debit-side journal convention, same negative-signed
// row — without this endpoint having to take a position on the still-open "does ATK accept a
// sales return as a nota kreditore" question (D4, docs/ACCOUNTANT_MILESTONE.md); that's a
// presentation/export question for B11 once the partner firm answers, not a data question here.
public record SalesBookLine(
    Guid InvoiceId,
    string? InvoiceNumber,
    DateOnly IssueDate,
    string DocumentType,
    Guid PartnerId,
    string PartnerName,
    string? PartnerTaxNumber,
    string? PartnerFiscalNumber,
    string VatCode,
    decimal Rate,
    decimal NetAmount,
    decimal VatAmount,
    decimal GrossAmount);

public record SalesBookResponse(
    DateOnly From,
    DateOnly To,
    List<SalesBookLine> Lines,
    decimal TotalNet,
    decimal TotalVat,
    decimal TotalGross);

public record PurchaseBookLine(
    Guid BillId,
    string? VendorReference,
    DateOnly IssueDate,
    string DocumentType,
    Guid PartnerId,
    string PartnerName,
    string? PartnerTaxNumber,
    string? PartnerFiscalNumber,
    string VatCode,
    decimal Rate,
    decimal NetAmount,
    decimal VatAmount,
    decimal GrossAmount);

public record PurchaseBookResponse(
    DateOnly From,
    DateOnly To,
    List<PurchaseBookLine> Lines,
    decimal TotalNet,
    decimal TotalVat,
    decimal TotalGross);
