using Pako.Domain.Reconciliation;

namespace Pako.Tests;

public class ReconciliationTests
{
    [Fact]
    public void ForInvoice_SetsInvoiceIdAndLeavesBillIdNull()
    {
        var companyId = Guid.NewGuid();
        var invoiceId = Guid.NewGuid();
        var lineId = Guid.NewGuid();

        var reconciliation = Reconciliation.ForInvoice(companyId, invoiceId, lineId, 50m);

        Assert.Equal(invoiceId, reconciliation.InvoiceId);
        Assert.Null(reconciliation.BillId);
        Assert.Equal(companyId, reconciliation.CompanyId);
        Assert.Equal(lineId, reconciliation.JournalEntryLineId);
        Assert.Equal(50m, reconciliation.Amount);
    }

    [Fact]
    public void ForBill_SetsBillIdAndLeavesInvoiceIdNull()
    {
        var reconciliation = Reconciliation.ForBill(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), 50m);

        Assert.NotNull(reconciliation.BillId);
        Assert.Null(reconciliation.InvoiceId);
    }

    [Fact]
    public void ForInvoice_NonPositiveAmount_Throws()
    {
        Assert.Throws<ArgumentException>(() => Reconciliation.ForInvoice(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), 0m));
    }
}
