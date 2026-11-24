using Microsoft.AspNetCore.Http;

namespace Pako.Api.Contracts;

// Bank statement import (docs/BANK_STATEMENTS.md). One [FromForm] class, like the other uploads, so
// NSwag keeps every field (see AttachmentContracts).
public class ImportBankStatementRequest
{
    public IFormFile? File { get; set; }
    public Guid? BankAccountId { get; set; }
}

// Row 0 = the file as a whole.
public record BankStatementImportError(int Row, string Message);

// Either the saved Draft statement (the preview) or the errors; nothing is saved when there are errors.
public record BankStatementImportResponse(BankStatementDetailResponse? Statement, List<BankStatementImportError> Errors);

public record BankStatementSummaryResponse(
    Guid Id,
    Guid BankAccountId,
    string BankAccountName,
    string FileName,
    DateOnly PeriodFrom,
    DateOnly PeriodTo,
    decimal OpeningBalance,
    decimal ClosingBalance,
    decimal TotalIn,
    decimal TotalOut,
    string State,
    int LineCount,
    int MatchedCount,
    int OpenCount,
    DateTime CreatedAt,
    DateTime? ConfirmedAt);

// MatchStatus: Matched (recorded as a payment), Ready (a document is chosen, recorded on confirm),
// Choose (partner known, has open documents), None, Ignored.
public record BankStatementLineResponse(
    Guid Id,
    int RowNumber,
    DateOnly Date,
    string Description,
    string? PartnerText,
    string? Reference,
    decimal AmountIn,
    decimal AmountOut,
    string State,
    string MatchStatus,
    bool IsDuplicate,
    Guid? PartnerId,
    string? PartnerName,
    Guid? InvoiceId,
    Guid? BillId,
    string? DocumentNumber,
    decimal? DocumentOutstanding,
    decimal? MatchAmount,
    Guid? JournalEntryId,
    Guid? PaymentId = null,
    Guid? DirectAccountId = null,
    string? DirectAccountName = null);

public record BankStatementDetailResponse(
    BankStatementSummaryResponse Summary,
    // Opening + in − out − closing; must be 0 to confirm.
    decimal BalanceDifference,
    // PAKO's own balance of the bank account the day before the period starts, to compare with the
    // statement's opening balance (a difference means movements missing in PAKO or in the file).
    decimal LedgerOpeningBalance,
    List<BankStatementLineResponse> Lines);

// An open invoice (money in) or bill (money out) a line can pay.
public record BankStatementCandidateResponse(
    string Kind, Guid Id, string Number, Guid PartnerId, string PartnerName, DateOnly IssueDate, decimal Outstanding);

// Ignore = true: the line is not a customer or supplier payment. InvoiceId/BillId (+ Amount, default
// the smaller of the line amount and what is open): pay that document. PaymentId: match to an
// outstanding payment (2-step clearing). DirectAccountId (+ optional DirectPartnerId): create a
// direct entry against an expense/revenue account. Nothing: clear back to Open.
public record UpdateBankStatementLineRequest(
    Guid? InvoiceId = null, Guid? BillId = null, decimal? Amount = null, bool? Ignore = null,
    Guid? PaymentId = null, Guid? DirectAccountId = null, Guid? DirectPartnerId = null);

// The bank accounts a statement can be imported into (ledger accounts of sub-type Bank).
public record BankStatementAccountResponse(Guid Id, string Code, string Name);
