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
            new Dictionary<Guid, TaxDefinition> { [taxDefinition.Id] = taxDefinition }, Guid.NewGuid(), Guid.NewGuid());

        Assert.Equal(bill.JournalEntryId, journalEntry.Id);
        Assert.Equal(BillState.Posted, bill.State);
        Assert.Equal(journalEntry.Lines.Sum(l => l.Debit), journalEntry.Lines.Sum(l => l.Credit));

        // Line entry is gross: UnitPrice 100 is the vendor's actual total, VAT included — the
        // payable is exactly 100, not 118; net (84.75) and VAT (15.25, the exact remainder) are
        // backed out of it.
        var payableLine = Assert.Single(journalEntry.Lines, l => l.AccountId == payableAccountId);
        Assert.Equal(100m, payableLine.Credit);
        Assert.Equal(0m, payableLine.Debit);
        Assert.Equal(bill.PartnerId, payableLine.PartnerId);

        var expenseLine = Assert.Single(journalEntry.Lines, l => l.AccountId == expenseAccountId);
        Assert.Equal(84.75m, expenseLine.Debit);
        Assert.Equal(0m, expenseLine.Credit);

        var taxLine = Assert.Single(journalEntry.Lines, l => l.AccountId == vatReceivableAccountId);
        Assert.Equal(15.25m, taxLine.Debit);
        Assert.Equal(0m, taxLine.Credit);
    }

    [Fact]
    public void Post_UnknownTaxDefinition_ThrowsClearly()
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var bill = BillWithLine(Guid.NewGuid(), Guid.NewGuid());

        var ex = Assert.Throws<InvalidOperationException>(() =>
            bill.Post(company, Guid.NewGuid(), Guid.NewGuid(), _taxComputationService,
                new Dictionary<Guid, TaxDefinition>(), Guid.NewGuid(), Guid.NewGuid()));

        Assert.Contains("unknown or inactive tax definition", ex.Message);
        Assert.Equal(BillState.Draft, bill.State);
    }

    [Fact]
    public void Post_UsesVendorReferenceAsJournalEntryReference()
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var bill = BillWithLine(Guid.NewGuid());

        var journalEntry = bill.Post(company, Guid.NewGuid(), Guid.NewGuid(), _taxComputationService,
            new Dictionary<Guid, TaxDefinition>(), Guid.NewGuid(), Guid.NewGuid());

        Assert.Equal("SUPPLIER-INV-1", journalEntry.Reference);
    }

    [Fact]
    public void Post_AlreadyPostedBill_Throws()
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var bill = BillWithLine(Guid.NewGuid());
        bill.Post(company, Guid.NewGuid(), Guid.NewGuid(), _taxComputationService, new Dictionary<Guid, TaxDefinition>(), Guid.NewGuid(), Guid.NewGuid());

        Assert.Throws<InvalidOperationException>(() =>
            bill.Post(company, Guid.NewGuid(), Guid.NewGuid(), _taxComputationService, new Dictionary<Guid, TaxDefinition>(), Guid.NewGuid(), Guid.NewGuid()));
    }

    [Fact]
    public void Post_CreditNote_ProducesEntryReversedFromANormalBill()
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
        var creditNote = BillWithLine(expenseAccountId, taxDefinition.Id);
        creditNote.DocumentType = DocumentType.CreditNote;

        var journalEntry = creditNote.Post(company, Guid.NewGuid(), payableAccountId, _taxComputationService,
            new Dictionary<Guid, TaxDefinition> { [taxDefinition.Id] = taxDefinition }, Guid.NewGuid(), Guid.NewGuid());

        Assert.Equal(journalEntry.Lines.Sum(l => l.Debit), journalEntry.Lines.Sum(l => l.Credit));

        var payableLine = Assert.Single(journalEntry.Lines, l => l.AccountId == payableAccountId);
        Assert.Equal(100m, payableLine.Debit);
        Assert.Equal(0m, payableLine.Credit);

        var expenseLine = Assert.Single(journalEntry.Lines, l => l.AccountId == expenseAccountId);
        Assert.Equal(84.75m, expenseLine.Credit);
        Assert.Equal(0m, expenseLine.Debit);

        var taxLine = Assert.Single(journalEntry.Lines, l => l.AccountId == vatReceivableAccountId);
        Assert.Equal(15.25m, taxLine.Credit);
        Assert.Equal(0m, taxLine.Debit);
    }

    [Fact]
    public void Post_DiscountedLine_ComputesCorrectNetAndTaxOnDiscountedAmount()
    {
        // 4 units at 50 with a 25% discount: gross = 4 * 50 * 0.75 = 150.00, not 200.00 —
        // discount applies to the entered (gross) price. VAT is backed out of that 150.00, not
        // added on top: net = 150.00 / 1.18 = 127.1186... rounds to 127.12, tax = the exact
        // remainder 150.00 - 127.12 = 22.88.
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
        var bill = new Bill
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            PartnerId = Guid.NewGuid(),
            VendorReference = "SUPPLIER-INV-2",
            IssueDate = new DateOnly(2026, 8, 26),
            DueDate = new DateOnly(2026, 9, 25),
            Lines =
            {
                new BillLine
                {
                    Id = Guid.NewGuid(),
                    Description = "Bulk supplies",
                    Quantity = 4m,
                    UnitPrice = 50m,
                    DiscountPercent = 25m,
                    ExpenseAccountId = expenseAccountId,
                    TaxDefinitionId = taxDefinition.Id
                }
            }
        };

        var journalEntry = bill.Post(company, Guid.NewGuid(), payableAccountId, _taxComputationService,
            new Dictionary<Guid, TaxDefinition> { [taxDefinition.Id] = taxDefinition }, Guid.NewGuid(), Guid.NewGuid());

        var expenseLine = Assert.Single(journalEntry.Lines, l => l.AccountId == expenseAccountId);
        Assert.Equal(127.12m, expenseLine.Debit);

        var taxLine = Assert.Single(journalEntry.Lines, l => l.AccountId == vatReceivableAccountId);
        Assert.Equal(22.88m, taxLine.Debit);

        var payableLine = Assert.Single(journalEntry.Lines, l => l.AccountId == payableAccountId);
        Assert.Equal(150m, payableLine.Credit);
    }

    // 60_Posting_Rules R10 (AUTO) — the realistic case, an imported service bill (Google Ads,
    // Microsoft 365, hosting). See InvoicePostingTests' identical test for the full rationale.
    [Fact]
    public void Post_ReverseChargeTaxDefinition_GeneratesReverseChargeInputAndOutputVatLinesAutomatically()
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var expenseAccountId = Guid.NewGuid();
        var payableAccountId = Guid.NewGuid();
        var reverseChargeInputId = Guid.NewGuid();
        var reverseChargeOutputId = Guid.NewGuid();
        var taxDefinition = new TaxDefinition
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            Rate = 0.18m,
            IsActive = true,
            IsReverseCharge = true
        };
        var bill = BillWithLine(expenseAccountId, taxDefinition.Id);

        var journalEntry = bill.Post(
            company, Guid.NewGuid(), payableAccountId, _taxComputationService,
            new Dictionary<Guid, TaxDefinition> { [taxDefinition.Id] = taxDefinition },
            reverseChargeInputId, reverseChargeOutputId);

        Assert.Equal(journalEntry.Lines.Sum(l => l.Debit), journalEntry.Lines.Sum(l => l.Credit));

        var payableLine = Assert.Single(journalEntry.Lines, l => l.AccountId == payableAccountId);
        Assert.Equal(100m, payableLine.Credit); // unaffected by the self-charged VAT

        var inputLine = Assert.Single(journalEntry.Lines, l => l.AccountId == reverseChargeInputId);
        Assert.Equal(18m, inputLine.Debit);

        var outputLine = Assert.Single(journalEntry.Lines, l => l.AccountId == reverseChargeOutputId);
        Assert.Equal(18m, outputLine.Credit);
    }
}
