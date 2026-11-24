using Microsoft.EntityFrameworkCore;
using Pako.Domain.Bills;
using Pako.Domain.Documents;
using Pako.Domain.Invoicing;
using Pako.Domain.Tax;
using Pako.Infrastructure;

namespace Pako.Api.Services;

// The amounts under a document list (client request 2026-11-24): each document's lines through the
// posting calculator (DocumentLineCalculator, the same as the invoice GET and the PDF), credit
// notes and returns negated, summed. Controllers only pass the filtered documents in.
public sealed class DocumentListTotalsService
{
    private readonly PakoDbContext _db;
    private readonly ITaxComputationService _tax;

    public DocumentListTotalsService(PakoDbContext db, ITaxComputationService tax)
    {
        _db = db;
        _tax = tax;
    }

    public async Task<DocumentLineAmounts> InvoicesAsync(Guid companyId, IReadOnlyList<Invoice> invoices)
    {
        var taxes = await TaxesAsync(companyId);
        return DocumentLineAmounts.Sum(invoices.Select(invoice =>
        {
            var amounts = DocumentLineAmounts.Sum(invoice.Lines.Select(line => DocumentLineCalculator.Amounts(
                line.Quantity, line.UnitPrice, line.DiscountPercent,
                line.TaxDefinitionId is { } taxId ? taxes.GetValueOrDefault(taxId) : null, _tax, invoice.PriceMode)));
            return invoice.DocumentType is Domain.Invoicing.DocumentType.CreditNote or Domain.Invoicing.DocumentType.SalesReturn
                ? amounts.Negated()
                : amounts;
        }));
    }

    public async Task<DocumentLineAmounts> BillsAsync(Guid companyId, IReadOnlyList<Bill> bills)
    {
        var taxes = await TaxesAsync(companyId);
        return DocumentLineAmounts.Sum(bills.Select(bill =>
        {
            var amounts = DocumentLineAmounts.Sum(bill.Lines.Select(line => DocumentLineCalculator.Amounts(
                line.Quantity, line.UnitPrice, line.DiscountPercent,
                line.TaxDefinitionId is { } taxId ? taxes.GetValueOrDefault(taxId) : null, _tax, bill.PriceMode)));
            return bill.DocumentType is Domain.Bills.DocumentType.CreditNote or Domain.Bills.DocumentType.PurchaseReturn
                ? amounts.Negated()
                : amounts;
        }));
    }

    // Orders carry no price mode: their prices are entered VAT-inclusive (SalesOrderLine.Gross).
    public async Task<DocumentLineAmounts> SalesOrdersAsync(Guid companyId, IReadOnlyList<SalesOrder> orders)
    {
        var taxes = await TaxesAsync(companyId);
        return DocumentLineAmounts.Sum(orders.SelectMany(o => o.Lines).Select(line => DocumentLineCalculator.Amounts(
            line.Quantity, line.UnitPrice, line.DiscountPercent,
            line.TaxDefinitionId is { } taxId ? taxes.GetValueOrDefault(taxId) : null, _tax)));
    }

    public async Task<DocumentLineAmounts> PurchaseOrdersAsync(Guid companyId, IReadOnlyList<PurchaseOrder> orders)
    {
        var taxes = await TaxesAsync(companyId);
        return DocumentLineAmounts.Sum(orders.SelectMany(o => o.Lines).Select(line => DocumentLineCalculator.Amounts(
            line.Quantity, line.UnitPrice, 0m,
            line.TaxDefinitionId is { } taxId ? taxes.GetValueOrDefault(taxId) : null, _tax)));
    }

    private Task<Dictionary<Guid, TaxDefinition>> TaxesAsync(Guid companyId) =>
        _db.TaxDefinitions.AsNoTracking().Include(t => t.RepartitionLines)
            .Where(t => t.CompanyId == companyId)
            .ToDictionaryAsync(t => t.Id);
}
