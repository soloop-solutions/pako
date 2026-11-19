namespace Pako.Domain.Assets;

public enum FixedAssetStatus
{
    Active = 0,
    Disposed = 1
}

// Client feedback 2026-11 (fixed assets v1): one asset in the register. Buying it is booked as
// today (a bill or a journal entry to the category's 15xxxx account); the register adds the
// straight-line depreciation plan, the monthly depreciation runs and the disposal entry.
// OpeningAccumulatedDepreciation is what was depreciated before the company used Pako (it is
// already in the opening balances), so depreciation continues from there instead of restarting.
[Pako.Domain.Shared.Audited]
public class FixedAsset
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public Guid CategoryId { get; set; }
    public DateOnly AcquisitionDate { get; set; }
    public DateOnly InServiceDate { get; set; }
    public decimal Cost { get; set; }
    public decimal ResidualValue { get; set; }
    public int UsefulLifeMonths { get; set; }
    public decimal OpeningAccumulatedDepreciation { get; set; }
    public string? SerialNumber { get; set; }
    public string? Location { get; set; }
    public string? Notes { get; set; }
    public FixedAssetStatus Status { get; set; } = FixedAssetStatus.Active;
    public DateOnly? DisposedOn { get; set; }
    public decimal? DisposalProceeds { get; set; }
    public Guid? DisposalJournalEntryId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
