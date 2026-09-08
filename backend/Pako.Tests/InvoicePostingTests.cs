using Pako.Domain.Companies;
using Pako.Domain.Invoicing;
using Pako.Domain.Tax;

namespace Pako.Tests;

public class InvoicePostingTests
{
    private readonly TaxComputationService _taxComputationService = new();
    private readonly IDocumentNumberService _documentNumberService = new DocumentNumberService();

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
            new Dictionary<Guid, TaxDefinition> { [taxDefinition.Id] = taxDefinition }, Guid.NewGuid(), Guid.NewGuid());
        // S0.1: numbering moved out of Invoice.Post() into IDocumentNumberService, called by the
        // controller after a successful Post() — mirrored here so this test still exercises the
        // same end state.
        invoice.InvoiceNumber = _documentNumberService.ReserveNext(company, invoice.DocumentType);
        journalEntry.Reference = invoice.InvoiceNumber;

        Assert.Equal(invoice.JournalEntryId, journalEntry.Id);
        Assert.Equal(InvoiceState.Posted, invoice.State);
        Assert.Equal("INV-0001", invoice.InvoiceNumber);
        Assert.Equal(journalEntry.Lines.Sum(l => l.Debit), journalEntry.Lines.Sum(l => l.Credit));

        // Line entry is gross (brutto): UnitPrice 100 is the total the customer pays, VAT
        // included — the receivable is exactly 100, not 118; net (84.75) and VAT (15.25) are
        // backed out of it (100 / 1.18 = 84.7457... rounds to 84.75; 15.25 is the exact
        // remainder, not an independently-rounded 84.75 * 0.18 = 15.26).
        var receivableLine = Assert.Single(journalEntry.Lines, l => l.AccountId == receivableAccountId);
        Assert.Equal(100m, receivableLine.Debit);
        Assert.Equal(invoice.PartnerId, receivableLine.PartnerId);

        var revenueLine = Assert.Single(journalEntry.Lines, l => l.AccountId == revenueAccountId);
        Assert.Equal(84.75m, revenueLine.Credit);

        var taxLine = Assert.Single(journalEntry.Lines, l => l.AccountId == vatPayableAccountId);
        Assert.Equal(15.25m, taxLine.Credit);
    }

    [Fact]
    public void Post_UnknownTaxDefinition_ThrowsClearly()
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var invoice = InvoiceWithLine(Guid.NewGuid(), Guid.NewGuid());

        var ex = Assert.Throws<InvalidOperationException>(() =>
            invoice.Post(company, Guid.NewGuid(), Guid.NewGuid(), _taxComputationService,
                new Dictionary<Guid, TaxDefinition>(), Guid.NewGuid(), Guid.NewGuid()));

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
                new Dictionary<Guid, TaxDefinition> { [taxDefinition.Id] = taxDefinition }, Guid.NewGuid(), Guid.NewGuid()));

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
                new Dictionary<Guid, TaxDefinition>(), Guid.NewGuid(), Guid.NewGuid());
            invoice.InvoiceNumber = _documentNumberService.ReserveNext(company, invoice.DocumentType);
            numbers.Add(invoice.InvoiceNumber!);
        }

        Assert.Equal(new[] { "INV-0001", "INV-0002", "INV-0003" }, numbers);
    }

    // S0.1: Invoice.Post() itself no longer touches numbering at all (success or failure), so at
    // this domain level the only thing left to prove is that a failed Post() has zero numbering
    // side effects. The full "a failed post never burns a number" guarantee now depends on the
    // caller only invoking IDocumentNumberService after a successful Post() — that's exercised at
    // the controller level by InvoicesControllerTests.Post_UnknownTaxDefinition_LeavesInvoiceNumberCounterUntouched.
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
                new Dictionary<Guid, TaxDefinition>(), Guid.NewGuid(), Guid.NewGuid()));

        Assert.Equal(1, company.NextInvoiceNumber);
        Assert.Null(invoice.InvoiceNumber);
        Assert.Equal(InvoiceState.Draft, invoice.State);
    }

    [Fact]
    public void Post_AlreadyPostedInvoice_Throws()
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var invoice = InvoiceWithLine(Guid.NewGuid());
        invoice.Post(company, Guid.NewGuid(), Guid.NewGuid(), _taxComputationService, new Dictionary<Guid, TaxDefinition>(), Guid.NewGuid(), Guid.NewGuid());

        Assert.Throws<InvalidOperationException>(() =>
            invoice.Post(company, Guid.NewGuid(), Guid.NewGuid(), _taxComputationService, new Dictionary<Guid, TaxDefinition>(), Guid.NewGuid(), Guid.NewGuid()));
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
            new Dictionary<Guid, TaxDefinition> { [taxDefinition.Id] = taxDefinition }, Guid.NewGuid(), Guid.NewGuid());

        Assert.Equal(journalEntry.Lines.Sum(l => l.Debit), journalEntry.Lines.Sum(l => l.Credit));

        var receivableLine = Assert.Single(journalEntry.Lines, l => l.AccountId == receivableAccountId);
        Assert.Equal(0m, receivableLine.Debit);
        Assert.Equal(100m, receivableLine.Credit);

        var revenueLine = Assert.Single(journalEntry.Lines, l => l.AccountId == revenueAccountId);
        Assert.Equal(84.75m, revenueLine.Debit);
        Assert.Equal(0m, revenueLine.Credit);

        var taxLine = Assert.Single(journalEntry.Lines, l => l.AccountId == vatPayableAccountId);
        Assert.Equal(15.25m, taxLine.Debit);
        Assert.Equal(0m, taxLine.Credit);
    }

    [Fact]
    public void Post_CreditNote_GetsOwnSequenceIndependentOfInvoiceNumbers()
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var revenueAccountId = Guid.NewGuid();
        var receivableAccountId = Guid.NewGuid();

        var invoice = InvoiceWithLine(revenueAccountId);
        invoice.Post(company, Guid.NewGuid(), receivableAccountId, _taxComputationService, new Dictionary<Guid, TaxDefinition>(), Guid.NewGuid(), Guid.NewGuid());
        invoice.InvoiceNumber = _documentNumberService.ReserveNext(company, invoice.DocumentType);

        var creditNote = InvoiceWithLine(revenueAccountId);
        creditNote.DocumentType = DocumentType.CreditNote;
        creditNote.Post(company, Guid.NewGuid(), receivableAccountId, _taxComputationService, new Dictionary<Guid, TaxDefinition>(), Guid.NewGuid(), Guid.NewGuid());
        creditNote.InvoiceNumber = _documentNumberService.ReserveNext(company, creditNote.DocumentType);

        var secondInvoice = InvoiceWithLine(revenueAccountId);
        secondInvoice.Post(company, Guid.NewGuid(), receivableAccountId, _taxComputationService, new Dictionary<Guid, TaxDefinition>(), Guid.NewGuid(), Guid.NewGuid());
        secondInvoice.InvoiceNumber = _documentNumberService.ReserveNext(company, secondInvoice.DocumentType);

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
        invoice.Post(company, Guid.NewGuid(), receivableAccountId, _taxComputationService, new Dictionary<Guid, TaxDefinition>(), Guid.NewGuid(), Guid.NewGuid());
        invoice.InvoiceNumber = _documentNumberService.ReserveNext(company, invoice.DocumentType);

        var creditNote = InvoiceWithLine(revenueAccountId);
        creditNote.DocumentType = DocumentType.CreditNote;
        creditNote.Post(company, Guid.NewGuid(), receivableAccountId, _taxComputationService, new Dictionary<Guid, TaxDefinition>(), Guid.NewGuid(), Guid.NewGuid());
        creditNote.InvoiceNumber = _documentNumberService.ReserveNext(company, creditNote.DocumentType);

        var debitNote = InvoiceWithLine(revenueAccountId);
        debitNote.DocumentType = DocumentType.DebitNote;
        var journalEntry = debitNote.Post(company, Guid.NewGuid(), receivableAccountId, _taxComputationService, new Dictionary<Guid, TaxDefinition>(), Guid.NewGuid(), Guid.NewGuid());
        debitNote.InvoiceNumber = _documentNumberService.ReserveNext(company, debitNote.DocumentType);

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
        // 2 units at 100 with a 10% discount: gross = 2 * 100 * 0.90 = 180.00, not 200.00 —
        // discount applies to the entered (gross) price, same as before. That 180.00 is what
        // the receivable line gets directly (gross entry); VAT is backed out of it, not added
        // on top: net = 180.00 / 1.18 = 152.5423... rounds to 152.54, tax = the exact remainder
        // 180.00 - 152.54 = 27.46 (not 152.54 * 0.18 = 27.4572 rounded independently to 27.46 —
        // here they happen to agree, but only because ComputeFromGross always uses the
        // remainder, never an independent rounding).
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
            new Dictionary<Guid, TaxDefinition> { [taxDefinition.Id] = taxDefinition }, Guid.NewGuid(), Guid.NewGuid());

        var revenueLine = Assert.Single(journalEntry.Lines, l => l.AccountId == revenueAccountId);
        Assert.Equal(152.54m, revenueLine.Credit);

        var taxLine = Assert.Single(journalEntry.Lines, l => l.AccountId == vatPayableAccountId);
        Assert.Equal(27.46m, taxLine.Credit);

        var receivableLine = Assert.Single(journalEntry.Lines, l => l.AccountId == receivableAccountId);
        Assert.Equal(180m, receivableLine.Debit);
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
        invoice.Post(company, Guid.NewGuid(), receivableAccountId, _taxComputationService, new Dictionary<Guid, TaxDefinition>(), Guid.NewGuid(), Guid.NewGuid());
        invoice.InvoiceNumber = _documentNumberService.ReserveNext(company, invoice.DocumentType);

        var downPayment = InvoiceWithLine(depositsAccountId);
        downPayment.DocumentType = DocumentType.DownPayment;
        var journalEntry = downPayment.Post(company, Guid.NewGuid(), receivableAccountId, _taxComputationService, new Dictionary<Guid, TaxDefinition>(), Guid.NewGuid(), Guid.NewGuid());
        downPayment.InvoiceNumber = _documentNumberService.ReserveNext(company, downPayment.DocumentType);

        var receivableLine = Assert.Single(journalEntry.Lines, l => l.AccountId == receivableAccountId);
        Assert.Equal(100m, receivableLine.Debit);

        var depositsLine = Assert.Single(journalEntry.Lines, l => l.AccountId == depositsAccountId);
        Assert.Equal(100m, depositsLine.Credit);
        Assert.Equal(0m, depositsLine.Debit);

        Assert.Equal("INV-0001", invoice.InvoiceNumber);
        Assert.Equal("DP-0001", downPayment.InvoiceNumber);
    }

    // 60_Posting_Rules R10 (AUTO): RC18 generates Dr 113300 / Cr 210300 automatically, on top
    // of (not instead of) the normal revenue/receivable lines — the self-charged VAT never
    // touches the receivable total.
    [Fact]
    public void Post_ReverseChargeTaxDefinition_GeneratesReverseChargeInputAndOutputVatLinesAutomatically()
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var revenueAccountId = Guid.NewGuid();
        var receivableAccountId = Guid.NewGuid();
        var reverseChargeInputId = Guid.NewGuid();
        var reverseChargeOutputId = Guid.NewGuid();
        var taxDefinition = new TaxDefinition
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            Rate = 0.18m,
            IsActive = true,
            IsReverseCharge = true
            // Deliberately no RepartitionLines — RC18 has none in the real Stage 3 seed either;
            // its posting comes entirely from this AUTO rule, not TaxComputationService.
        };
        var invoice = InvoiceWithLine(revenueAccountId, taxDefinition.Id);

        var journalEntry = invoice.Post(
            company, Guid.NewGuid(), receivableAccountId, _taxComputationService,
            new Dictionary<Guid, TaxDefinition> { [taxDefinition.Id] = taxDefinition },
            reverseChargeInputId, reverseChargeOutputId);

        Assert.Equal(journalEntry.Lines.Sum(l => l.Debit), journalEntry.Lines.Sum(l => l.Credit));

        var receivableLine = Assert.Single(journalEntry.Lines, l => l.AccountId == receivableAccountId);
        Assert.Equal(100m, receivableLine.Debit); // unaffected by the self-charged VAT

        var inputLine = Assert.Single(journalEntry.Lines, l => l.AccountId == reverseChargeInputId);
        Assert.Equal(18m, inputLine.Debit);
        Assert.Equal(0m, inputLine.Credit);
        Assert.Equal(taxDefinition.Id, inputLine.TaxId);

        var outputLine = Assert.Single(journalEntry.Lines, l => l.AccountId == reverseChargeOutputId);
        Assert.Equal(18m, outputLine.Credit);
        Assert.Equal(0m, outputLine.Debit);
    }
}
