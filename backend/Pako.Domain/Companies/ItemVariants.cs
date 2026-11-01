namespace Pako.Domain.Companies;

// docs/POS_PLAN.md P2 (fashion): style × size × colour. A template item holds what the variants
// share; each variant is an ordinary item (its own code, barcodes and stock) linked to the template
// and to one value per attribute, so the stock engine and every document work on it unchanged.
public class ItemAttribute
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string Name { get; set; } = string.Empty;
    public int SortOrder { get; set; }
    public List<ItemAttributeValue> Values { get; set; } = new();
}

public class ItemAttributeValue
{
    public Guid Id { get; set; }
    public Guid AttributeId { get; set; }
    public string Value { get; set; } = string.Empty;
    public int SortOrder { get; set; }
}

// The attribute value a variant carries (one per attribute).
public class ItemVariantValue
{
    public Guid ItemId { get; set; }
    public Guid AttributeValueId { get; set; }
}
