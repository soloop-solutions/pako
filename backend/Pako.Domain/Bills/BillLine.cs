namespace Pako.Domain.Bills;

public class BillLine
{
    public Guid Id { get; set; }
    public Guid BillId { get; set; }
    public string Description { get; set; } = string.Empty;
    public decimal Quantity { get; set; }
    public decimal UnitPrice { get; set; }
    public Guid? TaxDefinitionId { get; set; }
    public Guid ExpenseAccountId { get; set; }

    public Bill? Bill { get; set; }
}
