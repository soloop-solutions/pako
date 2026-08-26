using Pako.Domain.Companies;
using Pako.Domain.Invoicing;
using Pako.Domain.Tax;

namespace Pako.Tests;

public class InvoicePostingTests
{
    private readonly TaxComputationService _taxComputationService = new();

    private static Invoice InvoiceWithLine(Guid revenueAccountId, Guid? taxDefinitionId = null) => new()
    {
        Id = Guid.NewGuid(),
        CompanyId = Guid.NewGuid(),
        PartnerId = Guid.NewGuid(),
        IssueDate = new DateOnly(2026, 8, 26),
        DueDate = new DateOnly(2026, 9, 25),
        Lines =
        {
            new InvoiceLine
            {
                Id = Guid.NewGuid(),
                Description = "Consulting",
                Quantity = 1m,
                UnitPrice = 100m,
                RevenueAccountId = revenueAccountId,
                TaxDefinitionId = taxDefinitionId
            }
        }
    };

    [Fact]
    public void Post_ValidInvoiceWithTax_ProducesBalancedEntryWithCorrectSplit()
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var revenueAccountId = Guid.NewGuid();
        var receivableAccountId = Guid.NewGuid();
        var vatPayableAccountId = Guid.NewGuid();
        var taxDefinition = new TaxDefinition
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            Rate = 0.18m,
            IsActive = true,
            RepartitionLines = { new TaxRepartitionLine { AccountId = vatPayableAccountId, Percentage = 100m } }
        };
        var invoice = InvoiceWithLine(revenueAccountId, taxDefinition.Id);
        var journalId = Guid.NewGuid();

        var journalEntry = invoice.Post(company, journalId, receivableAccountId, _taxComputationService,
            new Dictionary<Guid, TaxDefinition> { [taxDefinition.Id] = taxDefinition });

        Assert.Equal(invoice.JournalEntryId, journalEntry.Id);
        Assert.Equal(InvoiceState.Posted, invoice.State);
        Assert.Equal("INV-0001", invoice.InvoiceNumber);
        Assert.Equal(journalEntry.Lines.Sum(l => l.Debit), journalEntry.Lines.Sum(l => l.Credit));

        var receivableLine = Assert.Single(journalEntry.Lines, l => l.AccountId == receivableAccountId);
        Assert.Equal(118m, receivableLine.Debit);
        Assert.Equal(invoice.PartnerId, receivableLine.PartnerId);

        var revenueLine = Assert.Single(journalEntry.Lines, l => l.AccountId == revenueAccountId);
        Assert.Equal(100m, revenueLine.Credit);

        var taxLine = Assert.Single(journalEntry.Lines, l => l.AccountId == vatPayableAccountId);
        Assert.Equal(18m, taxLine.Credit);
    }

    [Fact]
    public void Post_UnknownTaxDefinition_ThrowsClearly()
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var invoice = InvoiceWithLine(Guid.NewGuid(), Guid.NewGuid());

        var ex = Assert.Throws<InvalidOperationException>(() =>
            invoice.Post(company, Guid.NewGuid(), Guid.NewGuid(), _taxComputationService,
                new Dictionary<Guid, TaxDefinition>()));

        Assert.Contains("unknown or inactive tax definition", ex.Message);
        Assert.Equal(InvoiceState.Draft, invoice.State);
        Assert.Null(invoice.InvoiceNumber);
    }

    [Fact]
    public void Post_InactiveTaxDefinition_ThrowsClearly()
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var taxDefinition = new TaxDefinition { Id = Guid.NewGuid(), Rate = 0.18m, IsActive = false };
        var invoice = InvoiceWithLine(Guid.NewGuid(), taxDefinition.Id);

        var ex = Assert.Throws<InvalidOperationException>(() =>
            invoice.Post(company, Guid.NewGuid(), Guid.NewGuid(), _taxComputationService,
                new Dictionary<Guid, TaxDefinition> { [taxDefinition.Id] = taxDefinition }));

        Assert.Contains("unknown or inactive tax definition", ex.Message);
        Assert.Equal(InvoiceState.Draft, invoice.State);
    }

    [Fact]
    public void Post_MultipleInvoicesForSameCompany_NumbersAreGaplessAndMonotonic()
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var revenueAccountId = Guid.NewGuid();
        var receivableAccountId = Guid.NewGuid();

        var numbers = new List<string>();
        for (var i = 0; i < 3; i++)
        {
            var invoice = InvoiceWithLine(revenueAccountId);
            invoice.Post(company, Guid.NewGuid(), receivableAccountId, _taxComputationService,
                new Dictionary<Guid, TaxDefinition>());
            numbers.Add(invoice.InvoiceNumber!);
        }

        Assert.Equal(new[] { "INV-0001", "INV-0002", "INV-0003" }, numbers);
    }

    [Fact]
    public void Post_FailedPost_DoesNotBurnAnInvoiceNumber()
    {
        var company = new Company
        {
            Id = Guid.NewGuid(),
            Name = "Test Co",
            AccountingLockDate = new DateOnly(2026, 12, 31)
        };
        var invoice = InvoiceWithLine(Guid.NewGuid());

        Assert.Throws<Pako.Domain.Ledger.AccountingLockDateViolationException>(() =>
            invoice.Post(company, Guid.NewGuid(), Guid.NewGuid(), _taxComputationService,
                new Dictionary<Guid, TaxDefinition>()));

        Assert.Equal(1, company.NextInvoiceNumber);
        Assert.Null(invoice.InvoiceNumber);
        Assert.Equal(InvoiceState.Draft, invoice.State);
    }

    [Fact]
    public void Post_AlreadyPostedInvoice_Throws()
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var invoice = InvoiceWithLine(Guid.NewGuid());
        invoice.Post(company, Guid.NewGuid(), Guid.NewGuid(), _taxComputationService, new Dictionary<Guid, TaxDefinition>());

        Assert.Throws<InvalidOperationException>(() =>
            invoice.Post(company, Guid.NewGuid(), Guid.NewGuid(), _taxComputationService, new Dictionary<Guid, TaxDefinition>()));
    }
}
