using Microsoft.EntityFrameworkCore;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Domain.Ledger;
using Pako.Domain.Tax;
using Pako.Domain.Invoicing;
using Pako.Infrastructure;

namespace Pako.Api.Services;

public class TaxReportService(PakoDbContext db, CompanyAccessContext access)
{
    public async Task<VatReturnResponse> VatReturnAsync(Guid companyId, DateOnly from, DateOnly to)
    {
        var repartitionAccountsByTax = (await db.TaxRepartitionLines.AsNoTracking()
                .Select(r => new { r.TaxDefinitionId, r.AccountId })
                .ToListAsync())
            .Select(r => (r.TaxDefinitionId, r.AccountId))
            .ToHashSet();

        var taxedLines = await db.JournalEntryLines.AsNoTracking()
            .Where(l => l.JournalEntry!.CompanyId == companyId
                && l.JournalEntry.State == JournalEntryState.Posted
                && l.JournalEntry.Date >= from && l.JournalEntry.Date <= to
                && l.TaxId != null)
            .Select(l => new { TaxId = l.TaxId!.Value, l.AccountId, l.Debit, l.Credit })
            .ToListAsync();

        var taxPostingLines = taxedLines.Where(l => repartitionAccountsByTax.Contains((l.TaxId, l.AccountId)));

        var grouped = taxPostingLines
            .GroupBy(l => l.TaxId)
            .Select(g => new { TaxDefinitionId = g.Key, Debit = g.Sum(l => l.Debit), Credit = g.Sum(l => l.Credit) })
            .ToList();

        var taxDefinitionIds = grouped.Select(g => g.TaxDefinitionId).ToList();
        var taxDefinitions = await db.TaxDefinitions.AsNoTracking()
            .Where(t => taxDefinitionIds.Contains(t.Id))
            .ToDictionaryAsync(t => t.Id);

        var output = new List<VatReturnLine>();
        var input = new List<VatReturnLine>();

        foreach (var g in grouped)
        {
            if (!taxDefinitions.TryGetValue(g.TaxDefinitionId, out var taxDefinition))
            {
                continue;
            }

            if (taxDefinition.Scope == TaxScope.Sale)
            {
                output.Add(new VatReturnLine(taxDefinition.Id, taxDefinition.Name, taxDefinition.Rate, g.Credit - g.Debit));
            }
            else if (taxDefinition.Scope == TaxScope.Purchase)
            {
                input.Add(new VatReturnLine(taxDefinition.Id, taxDefinition.Name, taxDefinition.Rate, g.Debit - g.Credit));
            }
        }

        output = output.OrderBy(l => l.Name).ToList();
        input = input.OrderBy(l => l.Name).ToList();

        var totalOutput = output.Sum(l => l.Amount);
        var totalInput = input.Sum(l => l.Amount);

        return new VatReturnResponse(from, to, output, input, totalOutput, totalInput, totalOutput - totalInput);
    }

    public record TaxBookRow(
        Guid DocumentId, string? DocumentNumber, DateOnly IssueDate, string DocumentType,
        Guid PartnerId, string VatCode, decimal Rate, decimal NetAmount, decimal VatAmount,
        TaxDirection? Direction = null, decimal? DeductiblePercent = null, bool IsReverseCharge = false, TaxAtkBook? AtkBook = null,
        decimal? PostedDeductibleVat = null);

    // Shared by SalesBook (Invoice-sourced, AtkBook.Shitje, Credit-normal per
    // DocumentLineCalculator's creditsOnNormalSide=true for invoices) and PurchaseBook
    // (Bill-sourced, AtkBook.Blerje/BlerjeImport/BlerjeInvestime, Debit-normal for bills) —
    // same shape, opposite sign convention, exactly mirroring DocumentLineCalculator's own
    // Invoice-vs-Bill split rather than VatReturn's TaxDefinition.Scope (Scope collapses every
    // reverse-charge code to TaxScope.Both, which VatReturn's Sale/Purchase branches silently
    // drop — this method sources the sign from which document type owns the entry instead, so it
    // doesn't inherit that gap).
    public async Task<List<TaxBookRow>> BuildTaxBookRowsAsync(Guid companyId, DateOnly from, DateOnly to, bool isSalesBook, bool includeUnbooked = false)
    {
        var atkBooks = isSalesBook
            ? new[] { TaxAtkBook.Shitje }
            : new[] { TaxAtkBook.Blerje, TaxAtkBook.BlerjeImport, TaxAtkBook.BlerjeInvestime };

        var taxDefinitions = await db.TaxDefinitions.AsNoTracking()
            .Where(t => t.CompanyId == companyId && t.AtkBook != null && atkBooks.Contains(t.AtkBook!.Value))
            .Include(t => t.RepartitionLines.OrderBy(r => r.Id))
            .ToListAsync();
        var taxDefinitionsById = taxDefinitions.ToDictionary(t => t.Id);
        var taxIds = taxDefinitionsById.Keys.ToHashSet();
        var repartitionAccountsByTax = taxDefinitions
            .SelectMany(t => t.RepartitionLines.Select(r => (t.Id, r.AccountId)))
            .ToHashSet();

        var repartitionAccountIds = taxDefinitions.SelectMany(t => t.RepartitionLines.Select(r => r.AccountId)).Distinct().ToList();
        var deductibleAccountIds = (await db.Accounts.AsNoTracking()
                .Where(a => repartitionAccountIds.Contains(a.Id))
                .Select(a => new { a.Id, a.Code })
                .ToListAsync())
            .Where(a => a.Code.StartsWith("113") && a.Code != "113900")
            .Select(a => a.Id)
            .ToHashSet();

        var defaults = await db.CompanyAccountDefaults.AsNoTracking().FirstOrDefaultAsync(d => d.CompanyId == companyId);
        var reverseChargeInputAccountId = defaults?.ReverseChargeInputVatAccountId;
        var reverseChargeOutputAccountId = defaults?.ReverseChargeOutputVatAccountId;

        List<(Guid DocumentId, string? DocumentNumber, DateOnly IssueDate, string DocumentType, Guid PartnerId, Guid? JournalEntryId)> documents;
        if (isSalesBook)
        {
            documents = (await db.Invoices.AsNoTracking().VisibleTo(access)
                    .Where(i => i.CompanyId == companyId && i.State == InvoiceState.Posted && i.IssueDate >= from && i.IssueDate <= to)
                    .Select(i => new { i.Id, i.InvoiceNumber, i.IssueDate, i.DocumentType, i.PartnerId, i.JournalEntryId })
                    .ToListAsync())
                .Select(i => (i.Id, i.InvoiceNumber, i.IssueDate, i.DocumentType.ToString(), i.PartnerId, i.JournalEntryId))
                .ToList();
        }
        else
        {
            documents = (await db.Bills.AsNoTracking().VisibleTo(access)
                    .Where(b => b.CompanyId == companyId && b.State == Pako.Domain.Bills.BillState.Posted && b.IssueDate >= from && b.IssueDate <= to)
                    .Select(b => new { b.Id, b.VendorReference, b.IssueDate, b.DocumentType, b.PartnerId, b.JournalEntryId })
                    .ToListAsync())
                .Select(b => (b.Id, b.VendorReference, b.IssueDate, b.DocumentType.ToString(), b.PartnerId, b.JournalEntryId))
                .ToList();
        }

        var journalEntryIds = documents.Where(d => d.JournalEntryId != null).Select(d => d.JournalEntryId!.Value).ToList();
        var lines = await db.JournalEntryLines.AsNoTracking()
            .Where(l => journalEntryIds.Contains(l.JournalEntryId) && l.TaxId != null && taxIds.Contains(l.TaxId!.Value))
            .Select(l => new { l.JournalEntryId, TaxId = l.TaxId!.Value, l.AccountId, l.Debit, l.Credit })
            .ToListAsync();
        var linesByJournalEntry = lines.ToLookup(l => l.JournalEntryId);

        var rows = new List<TaxBookRow>();
        foreach (var doc in documents)
        {
            if (doc.JournalEntryId is not { } jeId)
            {
                continue;
            }

            foreach (var taxGroup in linesByJournalEntry[jeId].GroupBy(l => l.TaxId))
            {
                var taxDefinition = taxDefinitionsById[taxGroup.Key];
                var net = 0m;
                var vat = 0m;
                var postedDeductible = 0m;

                foreach (var line in taxGroup)
                {
                    var signedAmount = isSalesBook ? line.Credit - line.Debit : line.Debit - line.Credit;

                    // Known limitation: RC18/RC00 (reverse charge) post two self-balancing lines —
                    // debit input VAT, credit output VAT, same amount — so only the input side
                    // counts toward this book's VAT figure; the output side is excluded from both
                    // buckets rather than miscounted as a net purchase amount. VatReturn has the
                    // same reverse-charge gap today (Scope.Both matches neither of its Sale/
                    // Purchase branches, so these codes are silently absent there entirely) — this
                    // book is a strict improvement: the document still appears, net amount intact.
                    if (reverseChargeOutputAccountId is { } outId && line.AccountId == outId)
                    {
                        continue;
                    }

                    if (reverseChargeInputAccountId is { } inId && line.AccountId == inId)
                    {
                        vat += signedAmount;
                    }
                    else if (repartitionAccountsByTax.Contains((taxGroup.Key, line.AccountId)))
                    {
                        vat += signedAmount;
                        if (deductibleAccountIds.Contains(line.AccountId))
                        {
                            postedDeductible += signedAmount;
                        }
                    }
                    else
                    {
                        net += signedAmount;
                    }
                }

                if (net == 0m && vat == 0m)
                {
                    continue;
                }

                var splitsDeductibility = !isSalesBook && !taxDefinition.IsReverseCharge
                    && taxDefinition.DeductiblePercent is > 0m and < 100m
                    && taxDefinition.RepartitionLines.Any(r => deductibleAccountIds.Contains(r.AccountId))
                    && taxDefinition.RepartitionLines.Any(r => !deductibleAccountIds.Contains(r.AccountId));

                rows.Add(new TaxBookRow(
                    doc.DocumentId, doc.DocumentNumber, doc.IssueDate, doc.DocumentType,
                    doc.PartnerId, taxDefinition.Code ?? string.Empty, taxDefinition.Rate, net, vat,
                    taxDefinition.Direction, taxDefinition.DeductiblePercent, taxDefinition.IsReverseCharge, taxDefinition.AtkBook,
                    splitsDeductibility ? postedDeductible : null));
            }
        }

        if (includeUnbooked)
        {
            var allTaxDefinitions = await db.TaxDefinitions.AsNoTracking()
                .Where(t => t.CompanyId == companyId)
                .Include(t => t.RepartitionLines)
                .ToListAsync();
            var taxAccountIds = allTaxDefinitions.SelectMany(t => t.RepartitionLines.Select(r => r.AccountId)).ToHashSet();
            if (reverseChargeInputAccountId is { } rcIn) taxAccountIds.Add(rcIn);
            if (reverseChargeOutputAccountId is { } rcOut) taxAccountIds.Add(rcOut);

            var bookAccountIds = (await db.Accounts.AsNoTracking()
                    .Where(a => a.CompanyId == companyId && !a.IsControl)
                    .Select(a => new { a.Id, a.AccountType })
                    .ToListAsync())
                .Where(a => !taxAccountIds.Contains(a.Id) && (isSalesBook
                    ? AccountTypeDerivation.IsIncome(a.AccountType)
                    : (AccountTypeDerivation.IsExpense(a.AccountType) && a.AccountType != AccountType.Depreciation)
                        || a.AccountType is AccountType.FixedAsset or AccountType.NonCurrentAsset or AccountType.CurrentAsset))
                .Select(a => a.Id)
                .ToHashSet();

            var entryIds = documents.Where(d => d.JournalEntryId != null).Select(d => d.JournalEntryId!.Value).ToList();
            var unbookedLines = await db.JournalEntryLines.AsNoTracking()
                .Where(l => entryIds.Contains(l.JournalEntryId) && bookAccountIds.Contains(l.AccountId)
                    && (l.TaxId == null || !taxIds.Contains(l.TaxId.Value)))
                .Select(l => new { l.JournalEntryId, l.Debit, l.Credit })
                .ToListAsync();
            var netByEntry = unbookedLines
                .GroupBy(l => l.JournalEntryId)
                .ToDictionary(g => g.Key, g => g.Sum(l => isSalesBook ? l.Credit - l.Debit : l.Debit - l.Credit));

            foreach (var doc in documents)
            {
                var net = doc.JournalEntryId is { } entryId ? netByEntry.GetValueOrDefault(entryId) : 0m;
                var hasRows = rows.Any(r => r.DocumentId == doc.DocumentId);
                if (net != 0m || !hasRows)
                {
                    rows.Add(new TaxBookRow(
                        doc.DocumentId, doc.DocumentNumber, doc.IssueDate, doc.DocumentType,
                        doc.PartnerId, string.Empty, 0m, net, 0m));
                }
            }
        }

        return rows;
    }
}
