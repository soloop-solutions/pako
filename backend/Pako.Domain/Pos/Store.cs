namespace Pako.Domain.Pos;

// docs/POS_PLAN.md §12.1 (D10) — a shop of the company: its fiscal branch (ATK BranchId on every
// coupon), the warehouse it sells from and the price list it uses. A separate legal entity is a
// separate company, never a store.
public class Store
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Address { get; set; }
    // ATK BranchId (AI 01/2026 Art. 34) and the location printed and sent on coupons.
    public int FiscalBranchNumber { get; set; }
    public string Location { get; set; } = string.Empty;
    public Guid WarehouseId { get; set; }
    public Guid? PriceListId { get; set; }
    public string? ReceiptHeader { get; set; }
    public string? ReceiptFooter { get; set; }
    // P3: where tips are owed (Other Employee Liabilities 222100 when the chart has it).
    public Guid? TipsAccountId { get; set; }
    // P4: the store's online booking link (null: no online booking).
    public string? BookingToken { get; set; }
    // P5: the item tourist tax is charged as, per guest and night (its price is the rate; its
    // revenue account is the municipality's liability, its VAT code exempt).
    public Guid? TouristTaxItemId { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

// D9: what the till shows and does. Packs (docs/POS_PLAN.md §9) switch features on per profile.
public enum RegisterProfile
{
    Retail,
    Grocery,
    Cafe,
    Restaurant,
    Services,
    // P7: a fuel station forecourt till (nozzles, fleet cards).
    Forecourt,
    // P7: a self-checkout lane or ordering kiosk: card tenders only, age checks need an attendant.
    SelfCheckout,
}

// D3/D4: how coupons are fiscalized. Training issues nothing to ATK and prints "TRAINING".
public enum FiscalMode
{
    Training,
    Sef,
    Pef,
}

// A point of sale (till). ATK's PosId and the certificate belong to it (Art. 34: one certificate per
// SEF installation at each point of sale).
public class PosRegister
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid StoreId { get; set; }
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public RegisterProfile Profile { get; set; } = RegisterProfile.Retail;
    public FiscalMode FiscalMode { get; set; } = FiscalMode.Training;
    // ATK PosId, unique within the branch.
    public int FiscalPosNumber { get; set; }
    // From ATK EDI ("Kërkesë për Fiskalizim"), needed to onboard the point of sale.
    public string? FiscalizationNumber { get; set; }
    // The certificate ATK's CA signed for this till (public part only; the key stays on the till).
    public string? CertificatePem { get; set; }
    public string? CertificateThumbprint { get; set; }
    public DateTime? CertificateNotAfter { get; set; }
    // The cash account this till's drawer posts to (a Cash sub-type account).
    public Guid CashAccountId { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
