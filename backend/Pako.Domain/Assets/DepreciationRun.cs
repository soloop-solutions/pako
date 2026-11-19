namespace Pako.Domain.Assets;

public enum DepreciationRunState
{
    Posted = 0,
    Reversed = 1
}

// One month's depreciation for the whole register, posted as a single journal entry
// (Dr depreciation expense / Cr accumulated depreciation, one pair per category). Runs go forward
// month by month; only the latest posted run can be reversed, which reopens its month.
[Pako.Domain.Shared.Audited]
public class DepreciationRun
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    // The first day of the month depreciated.
    public DateOnly Period { get; set; }
    public DepreciationRunState State { get; set; } = DepreciationRunState.Posted;
    public decimal Total { get; set; }
    public Guid JournalEntryId { get; set; }
    public Guid? ReversalJournalEntryId { get; set; }
    public Guid PostedByUserId { get; set; }
    public DateTime PostedAt { get; set; } = DateTime.UtcNow;
    public List<DepreciationRunLine> Lines { get; set; } = new();
}

public class DepreciationRunLine
{
    public Guid Id { get; set; }
    public Guid DepreciationRunId { get; set; }
    public Guid FixedAssetId { get; set; }
    public decimal Amount { get; set; }
}
