using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Contracts;
using Pako.Api.Services.Notifications;
using Pako.Domain.Attachments;
using Pako.Domain.Bills;
using Pako.Domain.Companies;
using Pako.Domain.Hr;
using Pako.Domain.Ledger;
using Pako.Domain.Notifications;
using Pako.Domain.Payroll;
using PriceMode = Pako.Domain.Invoicing.PriceMode;
using Pako.Domain.Tax;
using Pako.Infrastructure;

namespace Pako.Api.Services;

public record ExpenseClaimResult(ExpenseClaim? Claim, string? Error)
{
    public static ExpenseClaimResult Fail(string error) => new(null, error);
}

// H13: expense claims from draft to reimbursement. Shared by self-service (MeController) and the
// HR screen (ExpenseClaimsController); every state change sends its notification.
public class ExpenseClaimService
{
    public const long MaxReceiptBytes = 10 * 1024 * 1024;

    private readonly PakoDbContext _db;
    private readonly NotificationOutbox _outbox;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public ExpenseClaimService(PakoDbContext db, NotificationOutbox outbox, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _outbox = outbox;
        _localizer = localizer;
    }

    public Task<ExpenseClaim?> LoadAsync(Guid companyId, Guid id) =>
        _db.ExpenseClaims.Include(c => c.Lines).FirstOrDefaultAsync(c => c.Id == id && c.CompanyId == companyId);

    // ---- Editing (Draft only) ----

    public async Task<string?> ApplyAsync(Guid companyId, ExpenseClaim claim, SaveExpenseClaimRequest request)
    {
        if (!claim.IsEditable) return _localizer["ExpenseClaimNotEditable"].Value;
        var title = request.Title?.Trim() ?? string.Empty;
        if (title.Length is 0 or > 200) return _localizer["ExpenseClaimTitleRequired"].Value;
        if (request.Lines.Count is 0 or > 100) return _localizer["ExpenseClaimLinesRequired"].Value;

        var accountIds = request.Lines.Select(l => l.ExpenseAccountId).Distinct().ToList();
        var validAccounts = await ExpenseAccountsQuery(companyId).Where(a => accountIds.Contains(a.Id)).Select(a => a.Id).ToListAsync();
        var taxIds = request.Lines.Where(l => l.TaxDefinitionId != null).Select(l => l.TaxDefinitionId!.Value).Distinct().ToList();
        var validTaxes = await InputVatQuery(companyId).Where(t => taxIds.Contains(t.Id)).Select(t => t.Id).ToListAsync();

        foreach (var line in request.Lines)
        {
            if (string.IsNullOrWhiteSpace(line.Description)) return _localizer["ExpenseClaimLineDescriptionRequired"].Value;
            if (line.Amount <= 0m || line.Amount != Math.Round(line.Amount, 2)) return _localizer["ExpenseClaimLineAmountInvalid"].Value;
            if (!validAccounts.Contains(line.ExpenseAccountId)) return _localizer["ExpenseClaimAccountInvalid"].Value;
            if (line.TaxDefinitionId is { } t && !validTaxes.Contains(t)) return _localizer["ExpenseClaimTaxInvalid"].Value;
        }

        claim.Title = title;
        _db.ExpenseClaimLines.RemoveRange(claim.Lines);
        claim.Lines = request.Lines.Select(l => new ExpenseClaimLine
        {
            Id = Guid.NewGuid(),
            ExpenseClaimId = claim.Id,
            Date = l.Date,
            Description = l.Description.Trim(),
            ExpenseAccountId = l.ExpenseAccountId,
            Amount = l.Amount,
            TaxDefinitionId = l.TaxDefinitionId,
            SupplierName = string.IsNullOrWhiteSpace(l.SupplierName) ? null : l.SupplierName.Trim(),
            SupplierFiscalNumber = string.IsNullOrWhiteSpace(l.SupplierFiscalNumber) ? null : l.SupplierFiscalNumber.Trim()
        }).ToList();
        _db.ExpenseClaimLines.AddRange(claim.Lines);
        return null;
    }

    public IQueryable<Account> ExpenseAccountsQuery(Guid companyId) => _db.Accounts.AsNoTracking()
        .Where(a => a.CompanyId == companyId && a.IsActive && a.IsPostable && !a.IsControl &&
            (a.AccountType == AccountType.Expense || a.AccountType == AccountType.OtherExpense || a.AccountType == AccountType.CostOfRevenue));

    public IQueryable<TaxDefinition> InputVatQuery(Guid companyId) => _db.TaxDefinitions.AsNoTracking()
        .Where(t => t.CompanyId == companyId && t.IsActive && t.Direction == TaxDirection.In && !t.IsReverseCharge && t.Type != TaxType.Withholding);

    // ---- Workflow ----

    public async Task<ExpenseClaimResult> SubmitAsync(ExpenseClaim claim)
    {
        if (claim.State != ExpenseClaimState.Draft) return ExpenseClaimResult.Fail(_localizer["ExpenseClaimNotEditable"].Value);
        if (claim.Lines.Count == 0) return ExpenseClaimResult.Fail(_localizer["ExpenseClaimLinesRequired"].Value);

        claim.Submit(DateTime.UtcNow);
        var employee = await _db.Employees.AsNoTracking().FirstAsync(e => e.Id == claim.EmployeeId);
        await _outbox.EnqueueAsync(claim.CompanyId, NotificationTemplates.ExpenseClaimSubmitted, await _outbox.LeaveApproversAsync(employee),
            new Dictionary<string, string>
            {
                ["employee"] = employee.Name,
                ["total"] = $"{claim.Total:N2} €",
                ["lines"] = claim.Lines.Count.ToString()
            });
        await _db.SaveChangesAsync();
        return new ExpenseClaimResult(claim, null);
    }

    public async Task<ExpenseClaimResult> CancelAsync(ExpenseClaim claim)
    {
        if (claim.State is not (ExpenseClaimState.Draft or ExpenseClaimState.Submitted)) return ExpenseClaimResult.Fail(_localizer["ExpenseClaimNotEditable"].Value);
        claim.State = ExpenseClaimState.Cancelled;
        await _db.SaveChangesAsync();
        return new ExpenseClaimResult(claim, null);
    }

    // Approving drafts the bill (to the employee as a partner, gross prices, receipts attached);
    // the accountant posts it from Purchases like any other bill.
    public async Task<ExpenseClaimResult> DecideAsync(ExpenseClaim claim, bool approve, Guid userId, string? note)
    {
        if (claim.State != ExpenseClaimState.Submitted) return ExpenseClaimResult.Fail(_localizer["ExpenseClaimNotSubmitted"].Value);

        var employee = await _db.Employees.AsNoTracking().FirstAsync(e => e.Id == claim.EmployeeId);
        if (approve && employee.UserId == userId) return ExpenseClaimResult.Fail(_localizer["CannotApproveOwnChange"].Value);

        claim.Decide(approve, userId, note, DateTime.UtcNow);
        if (approve)
        {
            var partnerId = await EmployeePartnerIdAsync(employee);
            var issueDate = claim.Lines.Max(l => l.Date);
            var bill = new Bill
            {
                Id = Guid.NewGuid(),
                CompanyId = claim.CompanyId,
                PartnerId = partnerId,
                IssueDate = issueDate,
                DueDate = issueDate,
                DocumentType = DocumentType.Bill,
                PriceMode = PriceMode.GrossInclusive,
                VendorReference = $"EXP-{claim.Id.ToString("N")[..8].ToUpperInvariant()}",
                InternalNotes = $"Expense claim: {claim.Title} ({employee.Name})",
                Lines = claim.Lines.OrderBy(l => l.Date).Select(l => new BillLine
                {
                    Id = Guid.NewGuid(),
                    Description = l.SupplierName is null
                        ? $"{l.Date:dd.MM.yyyy} {l.Description}"
                        : $"{l.Date:dd.MM.yyyy} {l.Description} — {l.SupplierName}{(l.SupplierFiscalNumber is null ? "" : " (" + l.SupplierFiscalNumber + ")")}",
                    Quantity = 1m,
                    UnitPrice = l.Amount,
                    ExpenseAccountId = l.ExpenseAccountId,
                    TaxDefinitionId = l.TaxDefinitionId
                }).ToList()
            };
            _db.Bills.Add(bill);
            claim.BillId = bill.Id;

            // The receipts travel with the bill so the accountant sees them where they post.
            var receipts = await _db.Attachments.AsNoTracking()
                .Where(a => a.CompanyId == claim.CompanyId && a.OwnerType == AttachmentOwnerType.ExpenseClaim && a.OwnerId == claim.Id)
                .ToListAsync();
            _db.Attachments.AddRange(receipts.Select(r => new Attachment
            {
                Id = Guid.NewGuid(),
                CompanyId = r.CompanyId,
                OwnerType = AttachmentOwnerType.Bill,
                OwnerId = bill.Id,
                FileName = r.FileName,
                ContentType = r.ContentType,
                SizeBytes = r.SizeBytes,
                Content = r.Content,
                UploadedAtUtc = r.UploadedAtUtc,
                UploadedByUserId = r.UploadedByUserId
            }));
        }

        if (await _outbox.EmployeeAsync(employee) is { } recipient)
        {
            await _outbox.EnqueueAsync(claim.CompanyId, NotificationTemplates.ExpenseClaimDecided, new[] { recipient }, new Dictionary<string, string>
            {
                ["employee"] = employee.Name,
                ["total"] = $"{claim.Total:N2} €",
                ["decision"] = NotificationRenderer.Text(approve ? "Email_Decision_Approved" : "Email_Decision_Rejected", recipient.Culture),
                ["note"] = claim.DecisionNote ?? string.Empty
            });
        }

        await _db.SaveChangesAsync();
        return new ExpenseClaimResult(claim, null);
    }

    // The partner expense-claim bills are issued to: created the first time it is needed.
    public async Task<Guid> EmployeePartnerIdAsync(Employee employee)
    {
        var existing = await _db.Partners.Where(p => p.CompanyId == employee.CompanyId && p.EmployeeId == employee.Id).Select(p => (Guid?)p.Id).FirstOrDefaultAsync();
        if (existing is { } id) return id;

        var partner = new Partner { Id = Guid.NewGuid(), CompanyId = employee.CompanyId, Name = employee.Name, IsVendor = true, EmployeeId = employee.Id };
        _db.Partners.Add(partner);
        return partner.Id;
    }

    // ---- Bill status and reimbursement ----

    public record BillStatus(Guid BillId, BillState State, decimal Total, decimal Reconciled)
    {
        public decimal Outstanding => State == BillState.Posted ? Total - Reconciled : 0m;
    }

    public async Task<Dictionary<Guid, BillStatus>> BillStatusesAsync(IReadOnlyCollection<Guid> billIds)
    {
        if (billIds.Count == 0) return new Dictionary<Guid, BillStatus>();
        var bills = await _db.Bills.AsNoTracking().Where(b => billIds.Contains(b.Id))
            .Select(b => new { b.Id, b.State, b.PartnerId, b.JournalEntryId }).ToListAsync();
        var entryIds = bills.Where(b => b.JournalEntryId != null).Select(b => b.JournalEntryId!.Value).ToList();
        var payableLines = await _db.JournalEntryLines.AsNoTracking()
            .Where(l => entryIds.Contains(l.JournalEntryId) && l.PartnerId != null)
            .Select(l => new { l.JournalEntryId, l.PartnerId, l.Credit, l.Debit })
            .ToListAsync();
        var reconciled = await _db.Reconciliations.AsNoTracking()
            .Where(r => r.BillId != null && billIds.Contains(r.BillId.Value))
            .GroupBy(r => r.BillId!.Value)
            .Select(g => new { g.Key, Sum = g.Sum(r => r.Amount) })
            .ToDictionaryAsync(x => x.Key, x => x.Sum);

        return bills.ToDictionary(b => b.Id, b => new BillStatus(
            b.Id,
            b.State,
            payableLines.Where(l => l.JournalEntryId == b.JournalEntryId && l.PartnerId == b.PartnerId).Sum(l => l.Credit - l.Debit),
            reconciled.GetValueOrDefault(b.Id)));
    }

    // Repays the claim's outstanding bill with the salary of the month given: a Reimbursement
    // adjustment that the month's payroll run picks up (and then settles the bill on posting).
    public async Task<ExpenseClaimResult> ReimburseViaPayrollAsync(ExpenseClaim claim, DateOnly anyDayInMonth)
    {
        if (claim.BillId is not { } billId) return ExpenseClaimResult.Fail(_localizer["ExpenseClaimBillNotPosted"].Value);
        var status = (await BillStatusesAsync(new[] { billId }))[billId];
        if (status.State != BillState.Posted) return ExpenseClaimResult.Fail(_localizer["ExpenseClaimBillNotPosted"].Value);
        if (status.Outstanding <= 0m) return ExpenseClaimResult.Fail(_localizer["ExpenseClaimAlreadyReimbursed"].Value);
        if (await _db.PayrollAdjustments.AnyAsync(a => a.ExpenseClaimId == claim.Id && a.PayrollRunId == null))
        {
            return ExpenseClaimResult.Fail(_localizer["ExpenseClaimAlreadyScheduled"].Value);
        }

        _db.PayrollAdjustments.Add(new PayrollAdjustment
        {
            Id = Guid.NewGuid(),
            CompanyId = claim.CompanyId,
            EmployeeId = claim.EmployeeId,
            Period = new DateOnly(anyDayInMonth.Year, anyDayInMonth.Month, 1),
            Kind = PayrollAdjustmentKind.Reimbursement,
            Description = claim.Title,
            Amount = status.Outstanding,
            ExpenseClaimId = claim.Id
        });
        await _db.SaveChangesAsync();
        return new ExpenseClaimResult(claim, null);
    }

    // After a payroll run posts: each Reimbursement settles its claim's bill against the run's
    // payable line for that employee. The caller saves.
    public async Task SettleReimbursementsAsync(Guid companyId, Guid runId, Guid journalEntryId)
    {
        var reimbursements = await _db.PayrollAdjustments.AsNoTracking()
            .Where(a => a.PayrollRunId == runId && a.Kind == PayrollAdjustmentKind.Reimbursement && a.ExpenseClaimId != null)
            .ToListAsync();
        if (reimbursements.Count == 0) return;

        var claimIds = reimbursements.Select(r => r.ExpenseClaimId!.Value).ToList();
        var bills = await _db.ExpenseClaims.AsNoTracking().Where(c => claimIds.Contains(c.Id) && c.BillId != null)
            .ToDictionaryAsync(c => c.Id, c => c.BillId!.Value);
        var debitLines = await _db.JournalEntryLines.AsNoTracking()
            .Where(l => l.JournalEntryId == journalEntryId && l.EmployeeId != null && l.PartnerId != null && l.Debit > 0m)
            .ToListAsync();

        foreach (var reimbursement in reimbursements)
        {
            if (!bills.TryGetValue(reimbursement.ExpenseClaimId!.Value, out var billId)) continue;
            var line = debitLines.FirstOrDefault(l => l.EmployeeId == reimbursement.EmployeeId);
            if (line is null) continue;
            await ReconciliationCreator.TryCreateAsync(_db, companyId, null, billId, line.Id, reimbursement.Amount);
        }
    }

    // ---- Receipts ----

    public async Task<(Attachment? Receipt, string? Error)> AddReceiptAsync(ExpenseClaim claim, IFormFile? file, Guid userId)
    {
        if (!claim.IsEditable) return (null, _localizer["ExpenseClaimNotEditable"].Value);
        var contentType = file?.ContentType ?? string.Empty;
        if (file is null || file.Length == 0 || file.Length > MaxReceiptBytes ||
            !(contentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase) || contentType.Equals("application/pdf", StringComparison.OrdinalIgnoreCase)))
        {
            return (null, _localizer["ExpenseReceiptInvalid"].Value);
        }

        using var stream = new MemoryStream();
        await file.CopyToAsync(stream);
        var receipt = new Attachment
        {
            Id = Guid.NewGuid(),
            CompanyId = claim.CompanyId,
            OwnerType = AttachmentOwnerType.ExpenseClaim,
            OwnerId = claim.Id,
            FileName = Path.GetFileName(file.FileName),
            ContentType = contentType,
            SizeBytes = file.Length,
            Content = stream.ToArray(),
            UploadedAtUtc = DateTime.UtcNow,
            UploadedByUserId = userId
        };
        _db.Attachments.Add(receipt);
        await _db.SaveChangesAsync();
        return (receipt, null);
    }

    public Task<Attachment?> ReceiptAsync(ExpenseClaim claim, Guid receiptId) =>
        _db.Attachments.FirstOrDefaultAsync(a => a.Id == receiptId && a.CompanyId == claim.CompanyId &&
            a.OwnerType == AttachmentOwnerType.ExpenseClaim && a.OwnerId == claim.Id);

    // ---- Responses ----

    public async Task<List<ExpenseClaimResponse>> ToResponsesAsync(List<ExpenseClaim> claims)
    {
        var claimIds = claims.Select(c => c.Id).ToList();
        var employeeIds = claims.Select(c => c.EmployeeId).Distinct().ToList();
        var names = await _db.Employees.AsNoTracking().Where(e => employeeIds.Contains(e.Id)).ToDictionaryAsync(e => e.Id, e => e.Name);
        var accountIds = claims.SelectMany(c => c.Lines).Select(l => l.ExpenseAccountId).Distinct().ToList();
        var accounts = await _db.Accounts.AsNoTracking().Where(a => accountIds.Contains(a.Id)).ToDictionaryAsync(a => a.Id, a => a.Code + " " + a.Name);
        var receipts = (await _db.Attachments.AsNoTracking()
                .Where(a => a.OwnerType == AttachmentOwnerType.ExpenseClaim && claimIds.Contains(a.OwnerId))
                .Select(a => new { a.OwnerId, Response = new AttachmentResponse(a.Id, a.OwnerType.ToString(), a.OwnerId, a.FileName, a.ContentType, a.SizeBytes, a.UploadedAtUtc) })
                .ToListAsync())
            .ToLookup(a => a.OwnerId, a => a.Response);
        var scheduled = await _db.PayrollAdjustments.AsNoTracking()
            .Where(a => a.ExpenseClaimId != null && claimIds.Contains(a.ExpenseClaimId.Value) && a.PayrollRunId == null)
            .ToDictionaryAsync(a => a.ExpenseClaimId!.Value, a => a.Period);
        var bills = await BillStatusesAsync(claims.Where(c => c.BillId != null).Select(c => c.BillId!.Value).ToList());

        return claims.Select(c =>
        {
            var bill = c.BillId is { } b ? bills.GetValueOrDefault(b) : null;
            return new ExpenseClaimResponse(c.Id, c.EmployeeId, names.GetValueOrDefault(c.EmployeeId, string.Empty), c.Title, StageOf(c, bill),
                c.Total, c.CreatedAt, c.SubmittedAt, c.DecidedAt, c.DecisionNote, c.BillId, bill?.Outstanding ?? 0m,
                scheduled.TryGetValue(c.Id, out var period) ? period : null,
                c.Lines.OrderBy(l => l.Date).Select(l => new ExpenseClaimLineResponse(l.Id, l.Date, l.Description, l.ExpenseAccountId,
                    accounts.GetValueOrDefault(l.ExpenseAccountId), l.Amount, l.TaxDefinitionId, l.SupplierName, l.SupplierFiscalNumber)).ToList(),
                receipts[c.Id].ToList());
        }).ToList();
    }

    public async Task<ExpenseOptionsResponse> OptionsAsync(Guid companyId) => new(
        await ExpenseAccountsQuery(companyId).OrderBy(a => a.Code).Select(a => new OptionItem(a.Id, a.Code + " " + a.Name)).ToListAsync(),
        await InputVatQuery(companyId).OrderByDescending(t => t.Rate).Select(t => new OptionItem(t.Id, t.Name)).ToListAsync());

    // Draft / Submitted / Rejected / Cancelled come from the claim itself; once approved the
    // stage follows the bill: BillDraft → Posted → Reimbursed (paid in full).
    public static string StageOf(ExpenseClaim claim, BillStatus? bill) => claim.State switch
    {
        ExpenseClaimState.Approved when bill is null || bill.State == BillState.Draft => "BillDraft",
        ExpenseClaimState.Approved when bill.State == BillState.Posted && bill.Outstanding <= 0m => "Reimbursed",
        ExpenseClaimState.Approved when bill.State == BillState.Posted => "Posted",
        ExpenseClaimState.Approved => "BillCancelled",
        _ => claim.State.ToString()
    };
}
