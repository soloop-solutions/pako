using Pako.Domain.Bills;
using Pako.Domain.Companies;
using Pako.Domain.Tax;

namespace Pako.Tests;

public class BillPostingTests
{
    private readonly TaxComputationService _taxComputationService = new();

    private static Bill BillWithLine(Guid expenseAccountId, Guid? taxDefinitionId = null) => new()
    {
        Id = Guid.NewGuid(),
        CompanyId = Guid.NewGuid(),
        PartnerId = Guid.NewGuid(),
        VendorReference = "SUPPLIER-INV-1",
        IssueDate = new DateOnly(2026, 8, 26),
        DueDate = new DateOnly(2026, 9, 25),
        Lines =
        {
            new BillLine
            {
                Id = Guid.NewGuid(),
                Description = "Office supplies",
                Quantity = 1m,
                UnitPrice = 100m,
                ExpenseAccountId = expenseAccountId,
                TaxDefinitionId = taxDefinitionId
            }
        }
    };

    [Fact]
    public void Post_ValidBillWithTax_ProducesBalancedEntryWithOppositeDirectionOfInvoicing()
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var expenseAccountId = Guid.NewGuid();
        var payableAccountId = Guid.NewGuid();
        var vatReceivableAccountId = Guid.NewGuid();
        var taxDefinition = new TaxDefinition
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            Rate = 0.18m,
            IsActive = true,
            RepartitionLines = { new TaxRepartitionLine { AccountId = vatReceivableAccountId, Percentage = 100m } }
        };
        var bill = BillWithLine(expenseAccountId, taxDefinition.Id);

        var journalEntry = bill.Post(company, Guid.NewGuid(), payableAccountId, _taxComputationService,
            new Dictionary<Guid, TaxDefinition> { [taxDefinition.Id] = taxDefinition });

        Assert.Equal(bill.JournalEntryId, journalEntry.Id);
        Assert.Equal(BillState.Posted, bill.State);
        Assert.Equal(journalEntry.Lines.Sum(l => l.Debit), journalEntry.Lines.Sum(l => l.Credit));

        var payableLine = Assert.Single(journalEntry.Lines, l => l.AccountId == payableAccountId);
        Assert.Equal(118m, payableLine.Credit);
        Assert.Equal(0m, payableLine.Debit);
        Assert.Equal(bill.PartnerId, payableLine.PartnerId);

        var expenseLine = Assert.Single(journalEntry.Lines, l => l.AccountId == expenseAccountId);
        Assert.Equal(100m, expenseLine.Debit);
        Assert.Equal(0m, expenseLine.Credit);

        var taxLine = Assert.Single(journalEntry.Lines, l => l.AccountId == vatReceivableAccountId);
        Assert.Equal(18m, taxLine.Debit);
        Assert.Equal(0m, taxLine.Credit);
    }

    [Fact]
    public void Post_UnknownTaxDefinition_ThrowsClearly()
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var bill = BillWithLine(Guid.NewGuid(), Guid.NewGuid());

        var ex = Assert.Throws<InvalidOperationException>(() =>
            bill.Post(company, Guid.NewGuid(), Guid.NewGuid(), _taxComputationService,
                new Dictionary<Guid, TaxDefinition>()));

        Assert.Contains("unknown or inactive tax definition", ex.Message);
        Assert.Equal(BillState.Draft, bill.State);
    }

    [Fact]
    public void Post_UsesVendorReferenceAsJournalEntryReference()
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var bill = BillWithLine(Guid.NewGuid());

        var journalEntry = bill.Post(company, Guid.NewGuid(), Guid.NewGuid(), _taxComputationService,
            new Dictionary<Guid, TaxDefinition>());

        Assert.Equal("SUPPLIER-INV-1", journalEntry.Reference);
    }

    [Fact]
    public void Post_AlreadyPostedBill_Throws()
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var bill = BillWithLine(Guid.NewGuid());
        bill.Post(company, Guid.NewGuid(), Guid.NewGuid(), _taxComputationService, new Dictionary<Guid, TaxDefinition>());

        Assert.Throws<InvalidOperationException>(() =>
            bill.Post(company, Guid.NewGuid(), Guid.NewGuid(), _taxComputationService, new Dictionary<Guid, TaxDefinition>()));
    }
}
