namespace Pako.Domain.Assets;

// Client feedback 2026-11 (fixed assets v1): a class of fixed assets and the three accounts its
// assets post to — the asset (15xxxx), its accumulated depreciation (159xxx) and the depreciation
// expense (65xxxx) — with the useful life new assets in it start from. Land and assets under
// construction are not depreciated: those categories carry no depreciation accounts.
[Pako.Domain.Shared.Audited]
public class AssetCategory
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string Name { get; set; } = string.Empty;
    public Guid AssetAccountId { get; set; }
    public bool IsDepreciable { get; set; } = true;
    public Guid? AccumulatedDepreciationAccountId { get; set; }
    public Guid? DepreciationExpenseAccountId { get; set; }
    public int DefaultUsefulLifeMonths { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
