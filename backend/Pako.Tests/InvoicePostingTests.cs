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

    [Fact]
    public void Post_CreditNote_ProducesEntryReversedFromANormalInvoice()
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
        var creditNote = InvoiceWithLine(revenueAccountId, taxDefinition.Id);
        creditNote.DocumentType = DocumentType.CreditNote;

        var journalEntry = creditNote.Post(company, Guid.NewGuid(), receivableAccountId, _taxComputationService,
            new Dictionary<Guid, TaxDefinition> { [taxDefinition.Id] = taxDefinition });

        Assert.Equal(journalEntry.Lines.Sum(l => l.Debit), journalEntry.Lines.Sum(l => l.Credit));

        var receivableLine = Assert.Single(journalEntry.Lines, l => l.AccountId == receivableAccountId);
        Assert.Equal(0m, receivableLine.Debit);
        Assert.Equal(118m, receivableLine.Credit);

        var revenueLine = Assert.Single(journalEntry.Lines, l => l.AccountId == revenueAccountId);
        Assert.Equal(100m, revenueLine.Debit);
        Assert.Equal(0m, revenueLine.Credit);

        var taxLine = Assert.Single(journalEntry.Lines, l => l.AccountId == vatPayableAccountId);
        Assert.Equal(18m, taxLine.Debit);
        Assert.Equal(0m, taxLine.Credit);
    }

    [Fact]
    public void Post_CreditNote_GetsOwnSequenceIndependentOfInvoiceNumbers()
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var revenueAccountId = Guid.NewGuid();
        var receivableAccountId = Guid.NewGuid();

        var invoice = InvoiceWithLine(revenueAccountId);
        invoice.Post(company, Guid.NewGuid(), receivableAccountId, _taxComputationService, new Dictionary<Guid, TaxDefinition>());

        var creditNote = InvoiceWithLine(revenueAccountId);
        creditNote.DocumentType = DocumentType.CreditNote;
        creditNote.Post(company, Guid.NewGuid(), receivableAccountId, _taxComputationService, new Dictionary<Guid, TaxDefinition>());

        var secondInvoice = InvoiceWithLine(revenueAccountId);
        secondInvoice.Post(company, Guid.NewGuid(), receivableAccountId, _taxComputationService, new Dictionary<Guid, TaxDefinition>());

        Assert.Equal("INV-0001", invoice.InvoiceNumber);
        Assert.Equal("CN-0001", creditNote.InvoiceNumber);
        Assert.Equal("INV-0002", secondInvoice.InvoiceNumber);
    }

    [Fact]
    public void Post_DebitNote_ProducesSameDirectionAsANormalInvoiceWithOwnSequence()
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var revenueAccountId = Guid.NewGuid();
        var receivableAccountId = Guid.NewGuid();

        var invoice = InvoiceWithLine(revenueAccountId);
        invoice.Post(company, Guid.NewGuid(), receivableAccountId, _taxComputationService, new Dictionary<Guid, TaxDefinition>());

        var creditNote = InvoiceWithLine(revenueAccountId);
        creditNote.DocumentType = DocumentType.CreditNote;
        creditNote.Post(company, Guid.NewGuid(), receivableAccountId, _taxComputationService, new Dictionary<Guid, TaxDefinition>());

        var debitNote = InvoiceWithLine(revenueAccountId);
        debitNote.DocumentType = DocumentType.DebitNote;
        var journalEntry = debitNote.Post(company, Guid.NewGuid(), receivableAccountId, _taxComputationService, new Dictionary<Guid, TaxDefinition>());

        var receivableLine = Assert.Single(journalEntry.Lines, l => l.AccountId == receivableAccountId);
        Assert.Equal(100m, receivableLine.Debit);
        Assert.Equal(0m, receivableLine.Credit);

        var revenueLine = Assert.Single(journalEntry.Lines, l => l.AccountId == revenueAccountId);
        Assert.Equal(100m, revenueLine.Credit);
        Assert.Equal(0m, revenueLine.Debit);

        Assert.Equal("INV-0001", invoice.InvoiceNumber);
        Assert.Equal("CN-0001", creditNote.InvoiceNumber);
        Assert.Equal("DN-0001", debitNote.InvoiceNumber);
    }

    [Fact]
    public void Post_DiscountedLine_ComputesCorrectNetAndTaxOnDiscountedAmount()
    {
        // 2 units at 100 with a 10% discount: net = 2 * 100 * 0.90 = 180.00, not 200.00.
        // VAT 18% on the discounted net: 180.00 * 0.18 = 32.40, not 200.00 * 0.18 = 36.00.
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
        var invoice = new Invoice
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            PartnerId = Guid.NewGuid(),
            IssueDate = new DateOnly(2026, 8, 26),
            DueDate = new DateOnly(2026, 9, 25),
            Lines =
            {
                new InvoiceLine
                {
                    Id = Guid.NewGuid(),
                    Description = "Consulting",
                    Quantity = 2m,
                    UnitPrice = 100m,
                    DiscountPercent = 10m,
                    RevenueAccountId = revenueAccountId,
                    TaxDefinitionId = taxDefinition.Id
                }
            }
        };

        var journalEntry = invoice.Post(company, Guid.NewGuid(), receivableAccountId, _taxComputationService,
            new Dictionary<Guid, TaxDefinition> { [taxDefinition.Id] = taxDefinition });

        var revenueLine = Assert.Single(journalEntry.Lines, l => l.AccountId == revenueAccountId);
        Assert.Equal(180m, revenueLine.Credit);

        var taxLine = Assert.Single(journalEntry.Lines, l => l.AccountId == vatPayableAccountId);
        Assert.Equal(32.40m, taxLine.Credit);

        var receivableLine = Assert.Single(journalEntry.Lines, l => l.AccountId == receivableAccountId);
        Assert.Equal(212.40m, receivableLine.Debit);
    }

    [Fact]
    public void Post_DownPayment_PostsSameDirectionAsANormalInvoiceCreditingWhicheverAccountItsLineTargets()
    {
        // Invoice.Post itself is account-agnostic — it credits whatever account the line carries.
        // Forcing that account to be the liability "Customer Deposits" account (not Revenue) for a
        // DownPayment is InvoicesController.Create's job (see the controller test); this test only
        // proves the posting direction and numbering are correct once that account is set.
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var depositsAccountId = Guid.NewGuid();
        var receivableAccountId = Guid.NewGuid();

        var invoice = InvoiceWithLine(Guid.NewGuid());
        invoice.Post(company, Guid.NewGuid(), receivableAccountId, _taxComputationService, new Dictionary<Guid, TaxDefinition>());

        var downPayment = InvoiceWithLine(depositsAccountId);
        downPayment.DocumentType = DocumentType.DownPayment;
        var journalEntry = downPayment.Post(company, Guid.NewGuid(), receivableAccountId, _taxComputationService, new Dictionary<Guid, TaxDefinition>());

        var receivableLine = Assert.Single(journalEntry.Lines, l => l.AccountId == receivableAccountId);
        Assert.Equal(100m, receivableLine.Debit);

        var depositsLine = Assert.Single(journalEntry.Lines, l => l.AccountId == depositsAccountId);
        Assert.Equal(100m, depositsLine.Credit);
        Assert.Equal(0m, depositsLine.Debit);

        Assert.Equal("INV-0001", invoice.InvoiceNumber);
        Assert.Equal("DP-0001", downPayment.InvoiceNumber);
    }
}
