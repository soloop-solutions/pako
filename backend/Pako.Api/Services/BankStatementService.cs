using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Domain.Banking;
using Pako.Domain.Bills;
using Pako.Domain.Invoicing;
using Pako.Domain.Ledger;
using Pako.Infrastructure;
using BillDocumentType = Pako.Domain.Bills.DocumentType;
using InvoiceDocumentType = Pako.Domain.Invoicing.DocumentType;

namespace Pako.Api.Services;

public readonly record struct BankStatementResult<T>(T? Value, string? Error = null, bool NotFound = false)
{
    public static BankStatementResult<T> Missing => new(default, null, true);
    public static BankStatementResult<T> Fail(string error) => new(default, error);
}

// Bank statement import (docs/BANK_STATEMENTS.md): the Excel template, reading an upload into a Draft
// statement with suggested matches, choosing matches, and confirming, which records each matched line
// as a payment through PaymentRecorder, exactly like "Record payment" on the invoice or bill.
//
// Only customer invoices (money in) and supplier bills (money out) are matched. Nothing is posted to
// any other account: a line that pays no document stays Open (or Ignored) and is entered by hand.
public class BankStatementService(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer, CompanyAccessContext access)
{
    public const long MaxFileBytes = 5 * 1024 * 1024;

    private static readonly InvoiceDocumentType[] PayableInvoiceTypes = [InvoiceDocumentType.Invoice, InvoiceDocumentType.DebitNote];

    // Balance-sheet accounts only: the seeded chart also tags some P&L accounts with the BANK
    // subledger (e.g. 700100 Interest Income), and a statement can't be imported into those.
    private static readonly AccountType[] StatementAccountTypes =
        [AccountType.Cash, AccountType.CurrentAsset, AccountType.CurrentLiability, AccountType.CreditCard];

    private string L(string key, params object[] args) => localizer[key, args].Value;

    public Task<List<BankStatementAccountResponse>> AccountsAsync(Guid companyId) =>
        db.Accounts.AsNoTracking()
            .Where(a => a.CompanyId == companyId && a.AccountSubType == AccountSubType.Bank && a.IsActive
                && StatementAccountTypes.Contains(a.AccountType))
            .OrderBy(a => a.Code)
            .Select(a => new BankStatementAccountResponse(a.Id, a.Code, a.Name))
            .ToListAsync();

    private Task<Account?> BankAccountAsync(Guid companyId, Guid accountId) =>
        db.Accounts.AsNoTracking().FirstOrDefaultAsync(a =>
            a.Id == accountId && a.CompanyId == companyId && a.AccountSubType == AccountSubType.Bank
            && StatementAccountTypes.Contains(a.AccountType));

    public async Task<BankStatementResult<byte[]>> TemplateAsync(Guid companyId, Guid bankAccountId, ExportLabels labels)
    {
        var account = await BankAccountAsync(companyId, bankAccountId);
        if (account is null) return BankStatementResult<byte[]>.Fail(L("BankStmtNotBankAccount"));

        // The IBAN only when the company has exactly one bank account on its profile: ledger accounts
        // aren't linked to IBANs, and guessing between several would print the wrong one.
        var ibans = await db.CompanyBankAccounts.AsNoTracking()
            .Where(b => b.CompanyId == companyId && b.Iban != null)
            .Select(b => b.Iban!).Take(2).ToListAsync();
        var opening = await LedgerBalanceAsync(companyId, bankAccountId, DateOnly.FromDateTime(DateTime.UtcNow));
        var info = new BankStatementTemplateInfo(account.Id, $"{account.Code} {account.Name}", ibans.Count == 1 ? ibans[0] : null, opening);
        return new(BankStatementWorkbook.Build(info, labels));
    }

    // Debit − credit of the bank account over posted entries up to and including `upTo`.
    private Task<decimal> LedgerBalanceAsync(Guid companyId, Guid accountId, DateOnly upTo) =>
        db.JournalEntryLines.AsNoTracking()
            .Where(l => l.AccountId == accountId
                && l.JournalEntry!.CompanyId == companyId
                && l.JournalEntry.State == JournalEntryState.Posted
                && l.JournalEntry.Date <= upTo)
            .SumAsync(l => l.Debit - l.Credit);

    public async Task<(BankStatementDetailResponse? Statement, List<BankStatementImportError> Errors)> ImportAsync(
        Guid companyId, Guid? bankAccountId, string fileName, byte[] content, Guid userId)
    {
        List<BankStatementImportError> Fail(string message) => [new(0, message)];

        if (bankAccountId is not { } accountId || await BankAccountAsync(companyId, accountId) is null)
            return (null, Fail(L("BankStmtNotBankAccount")));

        var hash = Convert.ToHexString(SHA256.HashData(content));
        if (await db.BankStatements.AnyAsync(s => s.CompanyId == companyId && s.FileHash == hash))
            return (null, Fail(L("BankStmtSameFile")));

        using var stream = new MemoryStream(content);
        var (parsed, rowErrors) = BankStatementWorkbook.Read(stream, (key, args) => L(key, args));
        if (parsed is null)
            return (null, rowErrors.Select(e => new BankStatementImportError(e.Row, e.Message)).ToList());

        if (parsed.BankAccountId is { } fileAccount && fileAccount != accountId)
            return (null, Fail(L("BankStmtOtherAccount")));

        var statement = new BankStatement
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            BankAccountId = accountId,
            FileName = Path.GetFileName(fileName) is { Length: > 0 } name ? name[..Math.Min(name.Length, 256)] : "statement.xlsx",
            FileHash = hash,
            PeriodFrom = parsed.PeriodFrom ?? parsed.Lines.Min(l => l.Date),
            PeriodTo = parsed.PeriodTo ?? parsed.Lines.Max(l => l.Date),
            OpeningBalance = parsed.OpeningBalance!.Value,
            ClosingBalance = parsed.ClosingBalance!.Value,
            CreatedByUserId = userId,
        };

        // Fingerprints: the n-th identical movement in the file is a different movement from the first.
        var occurrences = new Dictionary<string, int>();
        foreach (var row in parsed.Lines)
        {
            var key = $"{row.Date}|{row.AmountIn}|{row.AmountOut}|{row.Reference?.Trim().ToUpperInvariant()}";
            occurrences[key] = occurrences.GetValueOrDefault(key) + 1;
            statement.Lines.Add(new BankStatementLine
            {
                Id = Guid.NewGuid(),
                StatementId = statement.Id,
                RowNumber = row.Row,
                Date = row.Date,
                Description = row.Description,
                PartnerText = row.Partner,
                Reference = row.Reference,
                AmountIn = row.AmountIn,
                AmountOut = row.AmountOut,
                Fingerprint = BankStatementLine.FingerprintOf(accountId, row.Date, row.AmountIn, row.AmountOut, row.Reference, occurrences[key]),
            });
        }

        var fingerprints = statement.Lines.Select(l => l.Fingerprint).ToList();
        var seen = (await db.BankStatementLines.AsNoTracking()
                .Where(l => fingerprints.Contains(l.Fingerprint))
                .Join(db.BankStatements.Where(s => s.CompanyId == companyId), l => l.StatementId, s => s.Id, (l, _) => l.Fingerprint)
                .ToListAsync())
            .ToHashSet();
        foreach (var line in statement.Lines.Where(l => seen.Contains(l.Fingerprint)))
        {
            line.IsDuplicate = true;
            line.State = BankStatementLineState.Ignored;
        }

        // Suggested matches, in file order. First try outstanding payments (2-step), then
        // fall back to open invoices/bills (1-step).
        var book = await OpenBookAsync(companyId);
        var outstandingPayments = await OutstandingPaymentsAsync(companyId, accountId);
        var candidates = statement.Lines.Where(l => l.State == BankStatementLineState.Open).ToList();

        // Phase 1: match against outstanding payments (amount + partner or reference)
        var matchedPaymentIds = new HashSet<Guid>();
        foreach (var line in candidates)
        {
            var payment = outstandingPayments.FirstOrDefault(p =>
                !matchedPaymentIds.Contains(p.Id)
                && p.Amount == line.Amount
                && ((line.IsIncoming && p.Direction == Domain.Payments.PaymentDirection.Inbound)
                    || (!line.IsIncoming && p.Direction == Domain.Payments.PaymentDirection.Outbound)));
            if (payment is not null)
            {
                line.PaymentId = payment.Id;
                line.PartnerId = payment.PartnerId;
                line.MatchAmount = payment.Amount;
                matchedPaymentIds.Add(payment.Id);
            }
        }

        // Phase 2: for lines not matched to a payment, try invoices/bills
        var unmatched = candidates.Where(l => l.PaymentId is null).ToList();
        var suggestions = BankStatementMatcher.Suggest(
            unmatched.Select(l => new StatementLineInput(l.IsIncoming, l.Amount, l.Reference, l.PartnerText)).ToList(),
            book.Documents, book.Partners);
        for (var i = 0; i < unmatched.Count; i++)
        {
            var line = unmatched[i];
            var suggestion = suggestions[i];
            line.PartnerId ??= suggestion.PartnerId;
            if (suggestion is { Status: MatchStatus.Matched, Document: { } document })
            {
                SetMatch(line, document, suggestion.Amount);
            }
        }

        db.BankStatements.Add(statement);
        AuditController.Stage(db, companyId, "BankStatement", statement.Id.ToString(), "Import", userId.ToString(),
            $"File: {statement.FileName}, Lines: {statement.Lines.Count}");
        try
        {
            await db.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            // Two uploads of the same file at once: the unique (CompanyId, FileHash) index decides.
            return (null, Fail(L("BankStmtSameFile")));
        }

        return (await DetailAsync(companyId, statement.Id), []);
    }

    private static void SetMatch(BankStatementLine line, OpenDocument document, decimal amount)
    {
        line.PartnerId = document.PartnerId;
        line.InvoiceId = document.Kind == OpenDocumentKind.Invoice ? document.Id : null;
        line.BillId = document.Kind == OpenDocumentKind.Bill ? document.Id : null;
        line.MatchAmount = amount;
    }

    // Client request 2026-11-24: the list ribbon's filters. A statement matches a date range when its
    // period overlaps it.
    public sealed record ListFilter(Guid? BankAccountId = null, BankStatementState? State = null, DateOnly? From = null, DateOnly? To = null);

    private IQueryable<BankStatement> Filtered(Guid companyId, ListFilter? filter)
    {
        var query = db.BankStatements.AsNoTracking().Where(s => s.CompanyId == companyId);
        if (filter is null) return query;
        if (filter.BankAccountId is { } accountId) query = query.Where(s => s.BankAccountId == accountId);
        if (filter.State is { } state) query = query.Where(s => s.State == state);
        if (filter.From is { } from) query = query.Where(s => s.PeriodTo >= from);
        if (filter.To is { } to) query = query.Where(s => s.PeriodFrom <= to);
        return query;
    }

    /// <summary>Count and money in/out of the statements the list shows (the stored statement totals).</summary>
    public async Task<BankStatementListTotalsResponse> TotalsAsync(Guid companyId, ListFilter? filter = null)
    {
        var statements = Filtered(companyId, filter);
        var count = await statements.CountAsync();
        var lines = statements.SelectMany(s => s.Lines);
        var totalIn = await lines.SumAsync(l => (decimal?)l.AmountIn) ?? 0m;
        var totalOut = await lines.SumAsync(l => (decimal?)l.AmountOut) ?? 0m;
        return new BankStatementListTotalsResponse(count, totalIn, totalOut);
    }

    public async Task<List<BankStatementSummaryResponse>> ListAsync(Guid companyId, ListFilter? filter = null)
    {
        var statements = await Filtered(companyId, filter)
            .Include(s => s.Lines)
            .OrderByDescending(s => s.PeriodFrom).ThenByDescending(s => s.CreatedAt)
            .ToListAsync();
        var names = await AccountNamesAsync(companyId);
        return statements.Select(s => Summary(s, names)).ToList();
    }

    private Task<Dictionary<Guid, string>> AccountNamesAsync(Guid companyId) =>
        db.Accounts.AsNoTracking()
            .Where(a => a.CompanyId == companyId && a.AccountSubType == AccountSubType.Bank)
            .ToDictionaryAsync(a => a.Id, a => a.Code + " " + a.Name);

    private static BankStatementSummaryResponse Summary(BankStatement s, IReadOnlyDictionary<Guid, string> accountNames) => new(
        s.Id, s.BankAccountId, accountNames.GetValueOrDefault(s.BankAccountId, string.Empty), s.FileName,
        s.PeriodFrom, s.PeriodTo, s.OpeningBalance, s.ClosingBalance, s.TotalIn, s.TotalOut, s.State.ToString(),
        s.Lines.Count,
        s.Lines.Count(l => l.State == BankStatementLineState.Matched),
        s.Lines.Count(l => l.State == BankStatementLineState.Open),
        s.CreatedAt, s.ConfirmedAt);

    public async Task<BankStatementDetailResponse?> DetailAsync(Guid companyId, Guid statementId)
    {
        var statement = await db.BankStatements.AsNoTracking()
            .Include(s => s.Lines)
            .FirstOrDefaultAsync(s => s.Id == statementId && s.CompanyId == companyId);
        if (statement is null) return null;

        var book = await OpenBookAsync(companyId);
        var partnerNames = book.Partners.ToDictionary(p => p.Id, p => p.Name);
        var openByDocument = book.Documents.ToDictionary(d => d.Id);

        // Numbers of documents already paid in full (a Matched line's document is no longer open).
        var invoiceIds = statement.Lines.Where(l => l.InvoiceId != null).Select(l => l.InvoiceId!.Value).ToList();
        var billIds = statement.Lines.Where(l => l.BillId != null).Select(l => l.BillId!.Value).ToList();
        var invoiceNumbers = await db.Invoices.AsNoTracking().Where(i => i.CompanyId == companyId && invoiceIds.Contains(i.Id))
            .ToDictionaryAsync(i => i.Id, i => i.InvoiceNumber ?? string.Empty);
        var billNumbers = await db.Bills.AsNoTracking().Where(b => b.CompanyId == companyId && billIds.Contains(b.Id))
            .ToDictionaryAsync(b => b.Id, b => b.VendorReference ?? string.Empty);

        // Direct account names for lines with DirectAccountId
        var directAccountIds = statement.Lines.Where(l => l.DirectAccountId != null).Select(l => l.DirectAccountId!.Value).Distinct().ToList();
        var directAccountNames = directAccountIds.Count > 0
            ? await db.Accounts.AsNoTracking().Where(a => directAccountIds.Contains(a.Id))
                .ToDictionaryAsync(a => a.Id, a => $"{a.Code} {a.Name}")
            : new Dictionary<Guid, string>();

        var lines = statement.Lines.OrderBy(l => l.RowNumber).Select(l =>
        {
            var documentId = l.InvoiceId ?? l.BillId;
            var number = l.InvoiceId is { } invoiceId ? invoiceNumbers.GetValueOrDefault(invoiceId)
                : l.BillId is { } billId ? billNumbers.GetValueOrDefault(billId) : null;
            decimal? outstanding = documentId is { } docId && openByDocument.TryGetValue(docId, out var open) ? open.Outstanding
                : documentId is not null ? 0m : null;
            var kind = l.IsIncoming ? OpenDocumentKind.Invoice : OpenDocumentKind.Bill;
            var status = l.State switch
            {
                BankStatementLineState.Matched => "Matched",
                BankStatementLineState.Ignored => "Ignored",
                _ when l.HasMatch => "Ready",
                _ when l.PartnerId is { } p && book.Documents.Any(d => d.PartnerId == p && d.Kind == kind) => "Choose",
                _ => "None",
            };
            return new BankStatementLineResponse(
                l.Id, l.RowNumber, l.Date, l.Description, l.PartnerText, l.Reference, l.AmountIn, l.AmountOut,
                l.State.ToString(), status, l.IsDuplicate,
                l.PartnerId, l.PartnerId is { } pid ? partnerNames.GetValueOrDefault(pid) : null,
                l.InvoiceId, l.BillId, number, outstanding, l.MatchAmount, l.JournalEntryId,
                l.PaymentId, l.DirectAccountId,
                l.DirectAccountId is { } daId ? directAccountNames.GetValueOrDefault(daId) : null);
        }).ToList();

        var ledgerOpening = await LedgerBalanceAsync(companyId, statement.BankAccountId, statement.PeriodFrom.AddDays(-1));
        return new BankStatementDetailResponse(
            Summary(statement, await AccountNamesAsync(companyId)), statement.BalanceDifference, ledgerOpening, lines);
    }

    public async Task<BankStatementResult<List<BankStatementCandidateResponse>>> CandidatesAsync(
        Guid companyId, Guid statementId, Guid lineId, string? search)
    {
        var line = await LineAsync(companyId, statementId, lineId, tracked: false);
        if (line is null) return BankStatementResult<List<BankStatementCandidateResponse>>.Missing;

        var book = await OpenBookAsync(companyId);
        var names = book.Partners.ToDictionary(p => p.Id, p => p.Name);
        var kind = line.IsIncoming ? OpenDocumentKind.Invoice : OpenDocumentKind.Bill;
        var term = search?.Trim();
        var documents = book.Documents
            .Where(d => d.Kind == kind)
            .Where(d => string.IsNullOrEmpty(term)
                || d.Number.Contains(term, StringComparison.OrdinalIgnoreCase)
                || names.GetValueOrDefault(d.PartnerId, string.Empty).Contains(term, StringComparison.OrdinalIgnoreCase))
            // The line's own partner first, then the closest amount, then the oldest.
            .OrderByDescending(d => d.PartnerId == line.PartnerId)
            .ThenBy(d => Math.Abs(d.Outstanding - line.Amount))
            .ThenBy(d => d.IssueDate)
            .Take(50)
            .Select(d => new BankStatementCandidateResponse(
                d.Kind.ToString(), d.Id, d.Number, d.PartnerId, names.GetValueOrDefault(d.PartnerId, string.Empty), d.IssueDate, d.Outstanding))
            .ToList();
        return new(documents);
    }

    private async Task<BankStatementLine?> LineAsync(Guid companyId, Guid statementId, Guid lineId, bool tracked)
    {
        var query = tracked ? db.BankStatementLines : db.BankStatementLines.AsNoTracking();
        return await query
            .Where(l => l.Id == lineId && l.StatementId == statementId)
            .Join(db.BankStatements.Where(s => s.CompanyId == companyId), l => l.StatementId, s => s.Id, (l, _) => l)
            .FirstOrDefaultAsync();
    }

    public async Task<BankStatementResult<BankStatementDetailResponse>> UpdateLineAsync(
        Guid companyId, Guid statementId, Guid lineId, UpdateBankStatementLineRequest request)
    {
        var line = await LineAsync(companyId, statementId, lineId, tracked: true);
        if (line is null) return BankStatementResult<BankStatementDetailResponse>.Missing;
        if (line.State == BankStatementLineState.Matched)
            return BankStatementResult<BankStatementDetailResponse>.Fail(L("BankStmtLineAlreadyPosted"));

        if (request.Ignore == true)
        {
            line.ClearMatch();
            line.State = BankStatementLineState.Ignored;
        }
        else if (request.PaymentId is not null)
        {
            var payment = await db.Payments.AsNoTracking().FirstOrDefaultAsync(p =>
                p.Id == request.PaymentId && p.CompanyId == companyId && p.State == Domain.Payments.PaymentState.Posted);
            if (payment is null)
                return BankStatementResult<BankStatementDetailResponse>.Fail(L("PaymentNotFound"));

            line.ClearMatch();
            line.PaymentId = payment.Id;
            line.PartnerId = payment.PartnerId;
            line.MatchAmount = payment.Amount;
            line.State = BankStatementLineState.Open;
        }
        else if (request.DirectAccountId is not null)
        {
            var account = await db.Accounts.AsNoTracking().FirstOrDefaultAsync(a =>
                a.Id == request.DirectAccountId && a.CompanyId == companyId);
            if (account is null || !account.IsPostable)
                return BankStatementResult<BankStatementDetailResponse>.Fail(L("BankStmtDirectAccountNotPostable"));
            if (account.IsControl)
                return BankStatementResult<BankStatementDetailResponse>.Fail(L("BankStmtDirectAccountIsControl"));

            line.ClearMatch();
            line.DirectAccountId = account.Id;
            line.PartnerId = request.DirectPartnerId;
            line.State = BankStatementLineState.Open;
        }
        else if (request.InvoiceId is not null || request.BillId is not null)
        {
            if (request.InvoiceId is not null && request.BillId is not null)
                return BankStatementResult<BankStatementDetailResponse>.Fail(L("BankStmtOneDocument"));

            var kind = request.InvoiceId is not null ? OpenDocumentKind.Invoice : OpenDocumentKind.Bill;
            if ((kind == OpenDocumentKind.Invoice) != line.IsIncoming)
                return BankStatementResult<BankStatementDetailResponse>.Fail(L("BankStmtWrongDirection"));

            var documentId = (request.InvoiceId ?? request.BillId)!.Value;
            var document = (await OpenBookAsync(companyId)).Documents.FirstOrDefault(d => d.Kind == kind && d.Id == documentId);
            if (document is null)
                return BankStatementResult<BankStatementDetailResponse>.Fail(L("BankStmtDocumentNotOpen"));

            var amount = request.Amount ?? Math.Min(line.Amount, document.Outstanding);
            if (amount <= 0 || amount > line.Amount || amount > document.Outstanding)
                return BankStatementResult<BankStatementDetailResponse>.Fail(L("BankStmtAmountTooHigh", document.Outstanding, line.Amount));

            SetMatch(line, document, Math.Round(amount, 2));
            line.State = BankStatementLineState.Open;
        }
        else
        {
            line.ClearMatch();
            line.State = BankStatementLineState.Open;
        }

        await db.SaveChangesAsync();
        return new((await DetailAsync(companyId, statementId))!);
    }

    // Confirms a Draft: every Open line with a chosen document becomes a payment, all in one
    // transaction. Any failure (a lock date, a document paid meanwhile) rolls everything back and names
    // the row.
    public async Task<BankStatementResult<BankStatementDetailResponse>> ConfirmAsync(Guid companyId, Guid statementId, Guid userId)
    {
        var statement = await db.BankStatements.Include(s => s.Lines)
            .FirstOrDefaultAsync(s => s.Id == statementId && s.CompanyId == companyId);
        if (statement is null) return BankStatementResult<BankStatementDetailResponse>.Missing;
        if (statement.State != BankStatementState.Draft)
            return BankStatementResult<BankStatementDetailResponse>.Fail(L("BankStmtNotDraft"));
        if (statement.BalanceDifference != 0)
            return BankStatementResult<BankStatementDetailResponse>.Fail(L("BankStmtBalanceMismatch", statement.BalanceDifference));

        var lines = statement.Lines.Where(l => l.State == BankStatementLineState.Open && l.HasMatch).OrderBy(l => l.RowNumber).ToList();
        var error = await RecordAsync(companyId, statement, lines, userId, () =>
        {
            statement.State = BankStatementState.Confirmed;
            statement.ConfirmedAt = DateTime.UtcNow;
            AuditController.Stage(db, companyId, "BankStatement", statement.Id.ToString(), "Confirm", userId.ToString(),
                $"Payments: {lines.Count}");
        });
        return error is null
            ? new((await DetailAsync(companyId, statementId))!)
            : BankStatementResult<BankStatementDetailResponse>.Fail(error);
    }

    // On a Confirmed statement: records one Open line with a chosen document (matched after the fact).
    public async Task<BankStatementResult<BankStatementDetailResponse>> PostLineAsync(Guid companyId, Guid statementId, Guid lineId, Guid userId)
    {
        var statement = await db.BankStatements.Include(s => s.Lines)
            .FirstOrDefaultAsync(s => s.Id == statementId && s.CompanyId == companyId);
        var line = statement?.Lines.FirstOrDefault(l => l.Id == lineId);
        if (statement is null || line is null) return BankStatementResult<BankStatementDetailResponse>.Missing;
        if (statement.State != BankStatementState.Confirmed)
            return BankStatementResult<BankStatementDetailResponse>.Fail(L("BankStmtConfirmFirst"));
        if (line.State != BankStatementLineState.Open || !line.HasMatch)
            return BankStatementResult<BankStatementDetailResponse>.Fail(L("BankStmtNothingToPost"));

        var error = await RecordAsync(companyId, statement, [line], userId, () =>
            AuditController.Stage(db, companyId, "BankStatement", statement.Id.ToString(), "Match", userId.ToString(),
                $"Row: {line.RowNumber}"));
        return error is null
            ? new((await DetailAsync(companyId, statementId))!)
            : BankStatementResult<BankStatementDetailResponse>.Fail(error);
    }

    private async Task<string?> RecordAsync(
        Guid companyId, BankStatement statement, IReadOnlyList<BankStatementLine> lines, Guid userId, Action beforeCommit)
    {
        var company = await db.Companies.FirstOrDefaultAsync(c => c.Id == companyId);
        if (company is null) return L("BankStmtNothingToPost");

        var recorder = new PaymentRecorder(db, localizer);
        var transaction = db.Database.SupportsRowLocking() ? await db.Database.BeginTransactionAsync() : null;
        try
        {
            var clearingService = new PaymentClearingService(db, localizer);

            foreach (var line in lines)
            {
                // Branch 1: clearing an outstanding payment (2-step)
                if (line.PaymentId is { } paymentId)
                {
                    var payment = await db.Payments.FirstOrDefaultAsync(p => p.Id == paymentId && p.CompanyId == companyId);
                    if (payment is null || payment.State != Domain.Payments.PaymentState.Posted)
                        return await Abort(L("BankStmtRowError", line.RowNumber, L("PaymentNotFound")));

                    var clearResult = await clearingService.ClearAsync(company, payment, line.Date);
                    if (!clearResult.Succeeded)
                        return await Abort(L("BankStmtRowError", line.RowNumber, clearResult.Error!));

                    payment.BankStatementLineId = line.Id;
                    line.State = BankStatementLineState.Matched;
                    line.JournalEntryId = clearResult.Entry!.Id;
                    await db.SaveChangesAsync();
                    continue;
                }

                // Branch 2: direct entry (no invoice/bill/payment — user assigned an account)
                if (line.DirectAccountId is { } directAccountId)
                {
                    var directEntry = new JournalEntry
                    {
                        Id = Guid.NewGuid(),
                        CompanyId = companyId,
                        JournalId = (await JournalResolver.GetAsync(db, companyId, JournalType.Bank))!.Id,
                        Date = line.Date,
                        Reference = line.Description,
                    };
                    var bankLine = new JournalEntryLine
                    {
                        Id = Guid.NewGuid(), AccountId = statement.BankAccountId,
                        Debit = line.IsIncoming ? line.Amount : 0m,
                        Credit = line.IsIncoming ? 0m : line.Amount,
                    };
                    var accountLine = new JournalEntryLine
                    {
                        Id = Guid.NewGuid(), AccountId = directAccountId, PartnerId = line.PartnerId,
                        Debit = line.IsIncoming ? 0m : line.Amount,
                        Credit = line.IsIncoming ? line.Amount : 0m,
                    };
                    directEntry.Lines.Add(bankLine);
                    directEntry.Lines.Add(accountLine);
                    try { directEntry.Post(company); }
                    catch (Exception ex) when (ex is InvalidOperationException or UnbalancedJournalEntryException
                        or AccountingLockDateViolationException or TaxLockDateViolationException or HardLockDateViolationException)
                    {
                        return await Abort(L("BankStmtRowError", line.RowNumber, ex.Message));
                    }

                    db.JournalEntries.Add(directEntry);
                    line.State = BankStatementLineState.Matched;
                    line.JournalEntryId = directEntry.Id;
                    await db.SaveChangesAsync();
                    continue;
                }

                // Branch 3: invoice/bill match (original 1-step or 2-step depending on journal config)
                PaymentRecorder.Outcome outcome;
                if (line.InvoiceId is { } invoiceId)
                {
                    var invoice = await db.Invoices.AsNoTracking().VisibleTo(access)
                        .FirstOrDefaultAsync(i => i.Id == invoiceId && i.CompanyId == companyId);
                    if (invoice is null || invoice.State != InvoiceState.Posted)
                        return await Abort(L("BankStmtRowError", line.RowNumber, L("BankStmtDocumentNotOpen")));
                    outcome = await recorder.ForInvoiceAsync(company, invoice, line.MatchAmount!.Value, statement.BankAccountId, line.Date, userId.ToString());
                }
                else
                {
                    var bill = await db.Bills.AsNoTracking().VisibleTo(access)
                        .FirstOrDefaultAsync(b => b.Id == line.BillId && b.CompanyId == companyId);
                    if (bill is null || bill.State != BillState.Posted)
                        return await Abort(L("BankStmtRowError", line.RowNumber, L("BankStmtDocumentNotOpen")));
                    outcome = await recorder.ForBillAsync(company, bill, line.MatchAmount!.Value, statement.BankAccountId, line.Date);
                }

                if (!outcome.Succeeded)
                    return await Abort(L("BankStmtRowError", line.RowNumber, outcome.Error ?? L("BankStmtDocumentNotOpen")));

                line.State = BankStatementLineState.Matched;
                line.JournalEntryId = outcome.Entry!.Id;
                line.ReconciliationId = outcome.Reconciliation!.Id;
            }

            beforeCommit();
            await db.SaveChangesAsync();
            if (transaction is not null) await transaction.CommitAsync();
            return null;
        }
        finally
        {
            if (transaction is not null) await transaction.DisposeAsync();
        }

        async Task<string> Abort(string message)
        {
            // Without a transaction (in-memory tests) nothing below has been rolled back, so the caller
            // must not keep using this context; with one, disposing it rolls back every saved step.
            if (transaction is not null) await transaction.RollbackAsync();
            db.ChangeTracker.Clear();
            return message;
        }
    }

    public async Task<BankStatementResult<bool>> DeleteAsync(Guid companyId, Guid statementId, Guid userId)
    {
        var statement = await db.BankStatements.Include(s => s.Lines)
            .FirstOrDefaultAsync(s => s.Id == statementId && s.CompanyId == companyId);
        if (statement is null) return BankStatementResult<bool>.Missing;
        if (statement.State != BankStatementState.Draft) return BankStatementResult<bool>.Fail(L("BankStmtNotDraft"));

        db.BankStatements.Remove(statement);
        AuditController.Stage(db, companyId, "BankStatement", statement.Id.ToString(), "Delete", userId.ToString(),
            $"File: {statement.FileName}");
        await db.SaveChangesAsync();
        return new(true);
    }

    private sealed record OpenBook(List<OpenDocument> Documents, List<PartnerKey> Partners);

    // Every posted customer invoice / debit note and supplier bill with money still open, with the same
    // amounts the invoice and bill balance endpoints show: total = the document's own AR (debit) / AP
    // (credit) control line(s), less what is reconciled against it.
    private async Task<OpenBook> OpenBookAsync(Guid companyId)
    {
        var partners = await db.Partners.AsNoTracking()
            .Where(p => p.CompanyId == companyId)
            .Select(p => new { p.Id, p.Name, p.TaxNumber, p.FiscalNumber, p.ReceivableAccountId, p.PayableAccountId })
            .ToListAsync();
        var defaults = await db.CompanyAccountDefaults.AsNoTracking().FirstOrDefaultAsync(d => d.CompanyId == companyId);
        var byPartner = partners.ToDictionary(p => p.Id);
        Guid Receivable(Guid partnerId) => byPartner.GetValueOrDefault(partnerId)?.ReceivableAccountId ?? defaults?.ReceivableAccountId ?? Guid.Empty;
        Guid Payable(Guid partnerId) => byPartner.GetValueOrDefault(partnerId)?.PayableAccountId ?? defaults?.PayableAccountId ?? Guid.Empty;

        var invoices = await db.Invoices.AsNoTracking().VisibleTo(access)
            .Where(i => i.CompanyId == companyId && i.State == InvoiceState.Posted
                && PayableInvoiceTypes.Contains(i.DocumentType) && i.JournalEntryId != null)
            .Select(i => new { i.Id, i.InvoiceNumber, i.PartnerId, i.IssueDate, JournalEntryId = i.JournalEntryId!.Value })
            .ToListAsync();
        var bills = await db.Bills.AsNoTracking().VisibleTo(access)
            .Where(b => b.CompanyId == companyId && b.State == BillState.Posted
                && b.DocumentType == BillDocumentType.Bill && b.JournalEntryId != null)
            .Select(b => new { b.Id, b.VendorReference, b.PartnerId, b.IssueDate, JournalEntryId = b.JournalEntryId!.Value })
            .ToListAsync();

        var entryIds = invoices.Select(i => i.JournalEntryId).Concat(bills.Select(b => b.JournalEntryId)).ToList();
        var sums = (await db.JournalEntryLines.AsNoTracking()
                .Where(l => entryIds.Contains(l.JournalEntryId))
                .GroupBy(l => new { l.JournalEntryId, l.AccountId })
                .Select(g => new { g.Key.JournalEntryId, g.Key.AccountId, Debit = g.Sum(l => l.Debit), Credit = g.Sum(l => l.Credit) })
                .ToListAsync())
            .ToDictionary(s => (s.JournalEntryId, s.AccountId));

        var reconciled = await db.Reconciliations.AsNoTracking()
            .Where(r => r.CompanyId == companyId && (r.InvoiceId != null || r.BillId != null))
            .GroupBy(r => new { r.InvoiceId, r.BillId })
            .Select(g => new { g.Key.InvoiceId, g.Key.BillId, Amount = g.Sum(r => r.Amount) })
            .ToListAsync();
        var reconciledInvoices = reconciled.Where(r => r.InvoiceId != null).GroupBy(r => r.InvoiceId!.Value).ToDictionary(g => g.Key, g => g.Sum(r => r.Amount));
        var reconciledBills = reconciled.Where(r => r.BillId != null).GroupBy(r => r.BillId!.Value).ToDictionary(g => g.Key, g => g.Sum(r => r.Amount));

        var documents = new List<OpenDocument>();
        foreach (var invoice in invoices)
        {
            var total = sums.GetValueOrDefault((invoice.JournalEntryId, Receivable(invoice.PartnerId)))?.Debit ?? 0m;
            var open = total - reconciledInvoices.GetValueOrDefault(invoice.Id);
            if (open > 0)
                documents.Add(new OpenDocument(OpenDocumentKind.Invoice, invoice.Id, invoice.InvoiceNumber ?? string.Empty, invoice.PartnerId, invoice.IssueDate, open));
        }

        foreach (var bill in bills)
        {
            var total = sums.GetValueOrDefault((bill.JournalEntryId, Payable(bill.PartnerId)))?.Credit ?? 0m;
            var open = total - reconciledBills.GetValueOrDefault(bill.Id);
            if (open > 0)
                documents.Add(new OpenDocument(OpenDocumentKind.Bill, bill.Id, bill.VendorReference ?? string.Empty, bill.PartnerId, bill.IssueDate, open));
        }

        return new OpenBook(
            documents.OrderBy(d => d.IssueDate).ThenBy(d => d.Number).ToList(),
            partners.Select(p => new PartnerKey(p.Id, p.Name, p.TaxNumber, p.FiscalNumber)).ToList());
    }

    // All Payments in state Posted whose destination is the given bank account — i.e. payments that
    // were registered via "Record Payment" (2-step) but haven't been matched to a bank statement yet.
    private Task<List<Domain.Payments.Payment>> OutstandingPaymentsAsync(Guid companyId, Guid bankAccountId) =>
        db.Payments.AsNoTracking()
            .Where(p => p.CompanyId == companyId
                && p.State == Domain.Payments.PaymentState.Posted
                && p.DestinationAccountId == bankAccountId)
            .OrderBy(p => p.Date).ThenBy(p => p.CreatedAt)
            .ToListAsync();
}
