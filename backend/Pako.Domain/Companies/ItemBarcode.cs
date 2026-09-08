namespace Pako.Domain.Companies;

// S0.3 (Sprint 0 registers, additive/inert). CompanyId is denormalized from Item so the
// (CompanyId, Barcode) uniqueness index doesn't need a join.
public class ItemBarcode
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid ItemId { get; set; }
    public string Barcode { get; set; } = string.Empty;

    public Item? Item { get; set; }
}
