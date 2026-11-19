namespace Pako.Api.Contracts;

// Client feedback 2026-11: fixed assets register and straight-line depreciation (v1).

public record SaveAssetCategoryRequest(
    string Name,
    Guid AssetAccountId,
    bool IsDepreciable,
    Guid? AccumulatedDepreciationAccountId,
    Guid? DepreciationExpenseAccountId,
    int DefaultUsefulLifeMonths,
    bool? IsActive = null);

public record AssetCategoryResponse(
    Guid Id,
    string Name,
    Guid AssetAccountId,
    string AssetAccountCode,
    bool IsDepreciable,
    Guid? AccumulatedDepreciationAccountId,
    string? AccumulatedDepreciationAccountCode,
    Guid? DepreciationExpenseAccountId,
    string? DepreciationExpenseAccountCode,
    int DefaultUsefulLifeMonths,
    bool IsActive,
    int AssetCount);

// Code empty = the next number of the "FixedAsset" series. UsefulLifeMonths empty = the
// category's default. OpeningAccumulatedDepreciation: depreciation taken before the company used
// Pako (already in the opening balances).
public record SaveFixedAssetRequest(
    string? Code,
    string Name,
    Guid CategoryId,
    DateOnly AcquisitionDate,
    DateOnly InServiceDate,
    decimal Cost,
    decimal? ResidualValue = null,
    int? UsefulLifeMonths = null,
    decimal? OpeningAccumulatedDepreciation = null,
    string? SerialNumber = null,
    string? Location = null,
    string? Notes = null);

public record FixedAssetResponse(
    Guid Id,
    string Code,
    string Name,
    Guid CategoryId,
    string CategoryName,
    bool IsDepreciable,
    DateOnly AcquisitionDate,
    DateOnly InServiceDate,
    decimal Cost,
    decimal ResidualValue,
    int UsefulLifeMonths,
    decimal OpeningAccumulatedDepreciation,
    // Opening + every posted depreciation run.
    decimal AccumulatedDepreciation,
    decimal BookValue,
    // Cost − residual over the useful life; individual months can differ by a cent.
    decimal MonthlyDepreciation,
    DateOnly? LastDepreciatedPeriod,
    bool IsFullyDepreciated,
    // Active | Disposed
    string Status,
    DateOnly? DisposedOn,
    decimal? DisposalProceeds,
    Guid? DisposalJournalEntryId,
    // Posted depreciation exists: cost, dates, life, residual and category can no longer change.
    bool HasDepreciation,
    string? SerialNumber,
    string? Location,
    string? Notes);

public record DepreciationScheduleLineResponse(DateOnly Period, decimal Amount, decimal Accumulated, decimal BookValue, bool Posted);

public record FixedAssetDetailResponse(FixedAssetResponse Asset, List<DepreciationScheduleLineResponse> Schedule);

// Proceeds received for the asset, with the account they went to (cash, bank or a receivable).
// When the sale is invoiced separately, leave the proceeds empty: the whole book value is then
// booked as a loss here and the invoice books the sale price.
public record DisposeFixedAssetRequest(DateOnly Date, decimal? Proceeds = null, Guid? ProceedsAccountId = null);

public record DepreciationPreviewLine(
    Guid FixedAssetId,
    string Code,
    string Name,
    string CategoryName,
    decimal Amount,
    decimal AccumulatedAfter,
    decimal BookValueAfter);

public record DepreciationCategoryTotal(
    Guid CategoryId,
    string CategoryName,
    string ExpenseAccountCode,
    string AccumulatedAccountCode,
    decimal Amount);

public record DepreciationPreviewResponse(
    DateOnly Period,
    // The last month already posted, and the first month that can be posted next.
    DateOnly? LastPostedPeriod,
    bool AlreadyPosted,
    decimal Total,
    List<DepreciationPreviewLine> Lines,
    List<DepreciationCategoryTotal> Categories);

public record PostDepreciationRunRequest(DateOnly Period);

public record DepreciationRunResponse(
    Guid Id,
    DateOnly Period,
    // Posted | Reversed
    string State,
    decimal Total,
    int AssetCount,
    Guid JournalEntryId,
    Guid? ReversalJournalEntryId,
    DateTime PostedAt);

public record FixedAssetScheduleAmounts(
    decimal CostOpening,
    decimal Additions,
    decimal CostDisposed,
    decimal CostClosing,
    decimal AccumulatedOpening,
    decimal Depreciation,
    decimal AccumulatedDisposed,
    decimal AccumulatedClosing,
    decimal BookValueOpening,
    decimal BookValueClosing);

public record FixedAssetScheduleLine(
    Guid FixedAssetId,
    string Code,
    string Name,
    string CategoryName,
    FixedAssetScheduleAmounts Amounts);

public record FixedAssetScheduleCategory(string CategoryName, FixedAssetScheduleAmounts Amounts);

// Year-end depreciation schedule: cost and accumulated depreciation roll-forward per asset, with
// subtotals per category and a grand total, all computed by the API.
public record FixedAssetScheduleResponse(
    int Year,
    List<FixedAssetScheduleLine> Lines,
    List<FixedAssetScheduleCategory> Categories,
    FixedAssetScheduleAmounts Total);
