using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Auth;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Assets;
using Pako.Domain.Hr;
using Pako.Domain.Ledger;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

// Client feedback 2026-11 (fixed assets v1): the asset register, its categories, monthly
// straight-line depreciation runs and disposals, and the year-end depreciation schedule.
// Buying an asset is booked as today (a bill or journal entry to the category's 15xxxx account).
// The depreciation arithmetic lives in Pako.Domain.Assets (StraightLineDepreciation,
// FixedAssetRollForward); this controller loads, validates and posts.
[ApiController]
[Route("api/companies/{companyId:guid}/fixed-assets")]
[Authorize]
public class FixedAssetsController : ControllerBase
{
    // Gain and loss on the sale of assets in the Kosovo chart (PAKO_COA_v2_seed.csv).
    private const string GainOnDisposalCode = "420300";
    private const string LossOnDisposalCode = "661500";

    // The standard categories offered on an empty register: asset account, accumulated
    // depreciation, depreciation expense, useful life (months) — rates from the chart's notes.
    private static readonly (string Asset, string? Accumulated, string? Expense, int LifeMonths)[] DefaultCategories =
    {
        ("150100", null, null, 0),            // Land: not depreciated
        ("151100", "159100", "650100", 240),  // Buildings 5%
        ("152100", "159200", "650200", 120),  // Machinery and equipment 10%
        ("153100", "159500", "650400", 60),   // Furniture 20%
        ("154100", "159300", "650300", 60),   // Vehicles 20%
        ("155100", "159600", "650500", 60),   // Computers 20%
        ("155200", "159700", "650600", 60),   // Office equipment 20%
        ("157100", null, null, 0),            // Assets under construction: not depreciated until in use
        ("158100", "159400", "653100", 60),   // Software 20%
    };

    private readonly PakoDbContext _db;
    private readonly NumberSeriesService _numbers;
    private readonly IStringLocalizer<ErrorMessages> _localizer;
    private readonly ExportLabels _labels;

    public FixedAssetsController(PakoDbContext db, NumberSeriesService numbers, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _numbers = numbers;
        _localizer = localizer;
        _labels = new ExportLabels(localizer);
    }

    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    private string L(string key) => _localizer[key].Value;

    // ---------------------------------------------------------------- categories

    [HttpGet("categories", Name = "ListAssetCategories")]
    [RequireCompanyAccess(module: AccessModule.Accounting)]
    public async Task<ActionResult<List<AssetCategoryResponse>>> ListCategories(Guid companyId)
    {
        var categories = await _db.AssetCategories.AsNoTracking().Where(c => c.CompanyId == companyId).OrderBy(c => c.Name).ToListAsync();
        return Ok(await CategoryResponsesAsync(companyId, categories));
    }

    [HttpPost("categories", Name = "CreateAssetCategory")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Accounting)]
    [ProducesResponseType(typeof(AssetCategoryResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<AssetCategoryResponse>> CreateCategory(Guid companyId, SaveAssetCategoryRequest request)
    {
        var category = new AssetCategory { Id = Guid.NewGuid(), CompanyId = companyId };
        if (await ApplyCategoryAsync(companyId, category, request) is { } error) return BadRequest(error);
        _db.AssetCategories.Add(category);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, (await CategoryResponsesAsync(companyId, new() { category })).Single());
    }

    [HttpPut("categories/{id:guid}", Name = "UpdateAssetCategory")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Accounting)]
    public async Task<ActionResult<AssetCategoryResponse>> UpdateCategory(Guid companyId, Guid id, SaveAssetCategoryRequest request)
    {
        var category = await _db.AssetCategories.FirstOrDefaultAsync(c => c.Id == id && c.CompanyId == companyId);
        if (category is null) return NotFound();

        // Accounts and depreciability follow the posted history: once an asset of the category has
        // depreciation, they stay as they are (a later run would post to different accounts).
        var hasDepreciation = await (from l in _db.DepreciationRunLines
                                     join a in _db.FixedAssets on l.FixedAssetId equals a.Id
                                     where a.CategoryId == id
                                     select l.Id).AnyAsync();
        if (hasDepreciation && (request.AssetAccountId != category.AssetAccountId || request.IsDepreciable != category.IsDepreciable
            || request.AccumulatedDepreciationAccountId != category.AccumulatedDepreciationAccountId
            || request.DepreciationExpenseAccountId != category.DepreciationExpenseAccountId))
        {
            return BadRequest(L("AssetCategoryLockedByDepreciation"));
        }

        if (await ApplyCategoryAsync(companyId, category, request) is { } error) return BadRequest(error);
        await _db.SaveChangesAsync();
        return Ok((await CategoryResponsesAsync(companyId, new() { category })).Single());
    }

    // Creates the standard categories whose accounts exist in the company's chart and that are not
    // there yet (by asset account). Safe to call again.
    [HttpPost("categories/defaults", Name = "CreateDefaultAssetCategories")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Accounting)]
    public async Task<ActionResult<List<AssetCategoryResponse>>> CreateDefaultCategories(Guid companyId)
    {
        var codes = DefaultCategories.SelectMany(d => new[] { d.Asset, d.Accumulated, d.Expense }).OfType<string>().ToList();
        var accounts = await _db.Accounts.AsNoTracking()
            .Where(a => a.CompanyId == companyId && a.IsActive && codes.Contains(a.Code))
            .ToDictionaryAsync(a => a.Code);
        var existing = await _db.AssetCategories.Where(c => c.CompanyId == companyId).ToListAsync();
        var usedAccounts = existing.Select(c => c.AssetAccountId).ToHashSet();
        var usedNames = existing.Select(c => c.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);

        foreach (var d in DefaultCategories)
        {
            if (!accounts.TryGetValue(d.Asset, out var asset) || usedAccounts.Contains(asset.Id) || usedNames.Contains(asset.Name)) continue;
            var depreciable = d.Accumulated is not null;
            Account? accumulated = null, expense = null;
            if (depreciable && (!accounts.TryGetValue(d.Accumulated!, out accumulated) || !accounts.TryGetValue(d.Expense!, out expense))) continue;
            _db.AssetCategories.Add(new AssetCategory
            {
                Id = Guid.NewGuid(),
                CompanyId = companyId,
                Name = asset.Name,
                AssetAccountId = asset.Id,
                IsDepreciable = depreciable,
                AccumulatedDepreciationAccountId = accumulated?.Id,
                DepreciationExpenseAccountId = expense?.Id,
                DefaultUsefulLifeMonths = d.LifeMonths
            });
            usedNames.Add(asset.Name);
        }

        await _db.SaveChangesAsync();
        return await ListCategories(companyId);
    }

    private async Task<string?> ApplyCategoryAsync(Guid companyId, AssetCategory category, SaveAssetCategoryRequest request)
    {
        var name = request.Name?.Trim() ?? string.Empty;
        if (name.Length is 0 or > 128) return L("AssetCategoryNameRequired");
        if (await _db.AssetCategories.AnyAsync(c => c.CompanyId == companyId && c.Id != category.Id && c.Name == name))
        {
            return L("AssetCategoryNameTaken");
        }

        var ids = new[] { (Guid?)request.AssetAccountId, request.AccumulatedDepreciationAccountId, request.DepreciationExpenseAccountId }
            .OfType<Guid>().ToList();
        var accounts = await _db.Accounts.AsNoTracking().Where(a => a.CompanyId == companyId && ids.Contains(a.Id)).ToDictionaryAsync(a => a.Id);
        bool Usable(Guid? id) => id is { } x && accounts.TryGetValue(x, out var a) && a.IsActive && a.IsPostable && !a.IsControl;

        if (!Usable(request.AssetAccountId)) return L("AssetCategoryAccountInvalid");
        if (request.IsDepreciable)
        {
            if (!Usable(request.AccumulatedDepreciationAccountId) || !Usable(request.DepreciationExpenseAccountId))
            {
                return L("AssetCategoryDepreciationAccountsRequired");
            }

            if (request.DefaultUsefulLifeMonths is < 1 or > 1200) return L("FixedAssetUsefulLifeInvalid");
        }

        category.Name = name;
        category.AssetAccountId = request.AssetAccountId;
        category.IsDepreciable = request.IsDepreciable;
        category.AccumulatedDepreciationAccountId = request.IsDepreciable ? request.AccumulatedDepreciationAccountId : null;
        category.DepreciationExpenseAccountId = request.IsDepreciable ? request.DepreciationExpenseAccountId : null;
        category.DefaultUsefulLifeMonths = request.IsDepreciable ? request.DefaultUsefulLifeMonths : 0;
        category.IsActive = request.IsActive ?? category.IsActive;
        return null;
    }

    private async Task<List<AssetCategoryResponse>> CategoryResponsesAsync(Guid companyId, List<AssetCategory> categories)
    {
        var accountIds = categories.SelectMany(c => new[] { (Guid?)c.AssetAccountId, c.AccumulatedDepreciationAccountId, c.DepreciationExpenseAccountId })
            .OfType<Guid>().Distinct().ToList();
        var codes = await _db.Accounts.AsNoTracking().Where(a => accountIds.Contains(a.Id)).ToDictionaryAsync(a => a.Id, a => a.Code);
        var categoryIds = categories.Select(c => c.Id).ToList();
        var counts = await _db.FixedAssets.AsNoTracking().Where(a => a.CompanyId == companyId && categoryIds.Contains(a.CategoryId))
            .GroupBy(a => a.CategoryId).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Key, g => g.Count);
        string? Code(Guid? id) => id is { } x ? codes.GetValueOrDefault(x) : null;
        return categories.Select(c => new AssetCategoryResponse(c.Id, c.Name, c.AssetAccountId, Code(c.AssetAccountId) ?? string.Empty, c.IsDepreciable,
            c.AccumulatedDepreciationAccountId, Code(c.AccumulatedDepreciationAccountId), c.DepreciationExpenseAccountId, Code(c.DepreciationExpenseAccountId),
            c.DefaultUsefulLifeMonths, c.IsActive, counts.GetValueOrDefault(c.Id))).ToList();
    }

    // ---------------------------------------------------------------- assets

    // ?status=active|disposed, ?categoryId=, ?search= (code, name, serial number), ?sort=code|name|inService|cost (prefix - for descending).
    [HttpGet(Name = "ListFixedAssets")]
    [RequireCompanyAccess(module: AccessModule.Accounting)]
    public async Task<ActionResult<PaginatedResponse<FixedAssetResponse>>> List(
        Guid companyId,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        [FromQuery] string? search = null,
        [FromQuery] string? sort = null,
        [FromQuery] string? status = null,
        [FromQuery] Guid? categoryId = null)
    {
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 200);
        var query = _db.FixedAssets.AsNoTracking().Where(a => a.CompanyId == companyId);
        if (Enum.TryParse<FixedAssetStatus>(status, true, out var parsed)) query = query.Where(a => a.Status == parsed);
        if (categoryId is { } cat) query = query.Where(a => a.CategoryId == cat);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = LikePattern.Contains(search.Trim());
            query = query.Where(a => EF.Functions.ILike(a.Name, pattern, LikePattern.EscapeChar)
                                     || EF.Functions.ILike(a.Code, pattern, LikePattern.EscapeChar)
                                     || (a.SerialNumber != null && EF.Functions.ILike(a.SerialNumber, pattern, LikePattern.EscapeChar)));
        }

        var descending = sort is not null && sort.StartsWith('-');
        query = (descending ? sort![1..] : sort)?.ToLowerInvariant() switch
        {
            "name" => descending ? query.OrderByDescending(a => a.Name) : query.OrderBy(a => a.Name),
            "inservice" => descending ? query.OrderByDescending(a => a.InServiceDate) : query.OrderBy(a => a.InServiceDate),
            "cost" => descending ? query.OrderByDescending(a => a.Cost) : query.OrderBy(a => a.Cost),
            _ => descending ? query.OrderByDescending(a => a.Code) : query.OrderBy(a => a.Code)
        };

        var total = await query.CountAsync();
        var assets = await query.Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        return Ok(new PaginatedResponse<FixedAssetResponse>(await AssetResponsesAsync(assets), total, page, pageSize));
    }

    [HttpGet("{id:guid}", Name = "GetFixedAsset")]
    [RequireCompanyAccess(module: AccessModule.Accounting)]
    public async Task<ActionResult<FixedAssetDetailResponse>> Get(Guid companyId, Guid id)
    {
        var asset = await _db.FixedAssets.AsNoTracking().FirstOrDefaultAsync(a => a.Id == id && a.CompanyId == companyId);
        if (asset is null) return NotFound();
        var response = (await AssetResponsesAsync(new() { asset })).Single();

        var posted = await PostedLinesAsync(new[] { asset.Id });
        var postedPeriods = posted.Select(p => p.Period).ToHashSet();
        var schedule = response.IsDepreciable
            ? StraightLineDepreciation.Schedule(asset.Cost, asset.ResidualValue, asset.UsefulLifeMonths, asset.InServiceDate, asset.OpeningAccumulatedDepreciation)
                .Select(s => new DepreciationScheduleLineResponse(s.Period, s.Amount, s.Accumulated, s.BookValue, postedPeriods.Contains(s.Period)))
                .ToList()
            : new List<DepreciationScheduleLineResponse>();
        return Ok(new FixedAssetDetailResponse(response, schedule));
    }

    [HttpPost(Name = "CreateFixedAsset")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Accounting)]
    [ProducesResponseType(typeof(FixedAssetResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<FixedAssetResponse>> Create(Guid companyId, SaveFixedAssetRequest request)
    {
        var asset = new FixedAsset { Id = Guid.NewGuid(), CompanyId = companyId };
        if (await ApplyAssetAsync(companyId, asset, request, locked: false) is { } error) return BadRequest(error);
        if (string.IsNullOrWhiteSpace(asset.Code))
        {
            asset.Code = await _numbers.ReserveNextAsync(companyId, "FixedAsset", asset.AcquisitionDate);
        }

        _db.FixedAssets.Add(asset);
        try
        {
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateException ex) when (ex.InnerException is Npgsql.PostgresException { SqlState: "23505" })
        {
            return BadRequest(L("FixedAssetCodeTaken"));
        }

        return StatusCode(StatusCodes.Status201Created, (await AssetResponsesAsync(new() { asset })).Single());
    }

    // Before any depreciation is posted every field can change. After that only the descriptive
    // ones can (name, code, serial number, location, notes): the plan behind posted runs stays.
    [HttpPut("{id:guid}", Name = "UpdateFixedAsset")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Accounting)]
    public async Task<ActionResult<FixedAssetResponse>> Update(Guid companyId, Guid id, SaveFixedAssetRequest request)
    {
        var asset = await _db.FixedAssets.FirstOrDefaultAsync(a => a.Id == id && a.CompanyId == companyId);
        if (asset is null) return NotFound();
        var locked = asset.Status == FixedAssetStatus.Disposed || await _db.DepreciationRunLines.AnyAsync(l => l.FixedAssetId == id);
        if (await ApplyAssetAsync(companyId, asset, request, locked) is { } error) return BadRequest(error);
        if (string.IsNullOrWhiteSpace(asset.Code)) return BadRequest(L("FixedAssetCodeRequired"));

        try
        {
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateException ex) when (ex.InnerException is Npgsql.PostgresException { SqlState: "23505" })
        {
            return BadRequest(L("FixedAssetCodeTaken"));
        }

        return Ok((await AssetResponsesAsync(new() { asset })).Single());
    }

    // Only an asset entered by mistake: nothing depreciated or disposed yet.
    [HttpDelete("{id:guid}", Name = "DeleteFixedAsset")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Accounting)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Delete(Guid companyId, Guid id)
    {
        var asset = await _db.FixedAssets.FirstOrDefaultAsync(a => a.Id == id && a.CompanyId == companyId);
        if (asset is null) return NotFound();
        if (asset.Status == FixedAssetStatus.Disposed || await _db.DepreciationRunLines.AnyAsync(l => l.FixedAssetId == id))
        {
            return BadRequest(L("FixedAssetHasDepreciation"));
        }

        _db.FixedAssets.Remove(asset);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    private async Task<string?> ApplyAssetAsync(Guid companyId, FixedAsset asset, SaveFixedAssetRequest request, bool locked)
    {
        var name = request.Name?.Trim() ?? string.Empty;
        if (name.Length is 0 or > 256) return L("FixedAssetNameRequired");
        var code = request.Code?.Trim();
        if (code is { Length: > 32 }) return L("FixedAssetCodeRequired");
        if (!string.IsNullOrEmpty(code) && await _db.FixedAssets.AnyAsync(a => a.CompanyId == companyId && a.Id != asset.Id && a.Code == code))
        {
            return L("FixedAssetCodeTaken");
        }

        var category = await _db.AssetCategories.AsNoTracking().FirstOrDefaultAsync(c => c.Id == request.CategoryId && c.CompanyId == companyId);
        if (category is null) return L("FixedAssetCategoryNotFound");

        var residual = request.ResidualValue ?? 0m;
        var opening = request.OpeningAccumulatedDepreciation ?? 0m;
        var life = category.IsDepreciable ? request.UsefulLifeMonths ?? category.DefaultUsefulLifeMonths : 0;

        if (locked)
        {
            if (request.CategoryId != asset.CategoryId || request.AcquisitionDate != asset.AcquisitionDate || request.InServiceDate != asset.InServiceDate
                || request.Cost != asset.Cost || residual != asset.ResidualValue || life != asset.UsefulLifeMonths || opening != asset.OpeningAccumulatedDepreciation)
            {
                return L("FixedAssetLockedByDepreciation");
            }
        }
        else
        {
            if (!category.IsActive) return L("FixedAssetCategoryNotFound");
            if (request.InServiceDate < request.AcquisitionDate) return L("FixedAssetDatesInvalid");
            if (request.Cost <= 0m || request.Cost != Math.Round(request.Cost, 2) || request.Cost > 1_000_000_000m
                || residual < 0m || residual > request.Cost || residual != Math.Round(residual, 2))
            {
                return L("FixedAssetAmountsInvalid");
            }

            if (category.IsDepreciable && life is < 1 or > 1200) return L("FixedAssetUsefulLifeInvalid");
            if (opening < 0m || opening != Math.Round(opening, 2) || opening > StraightLineDepreciation.DepreciableBase(request.Cost, residual))
            {
                return L("FixedAssetOpeningInvalid");
            }

            asset.CategoryId = category.Id;
            asset.AcquisitionDate = request.AcquisitionDate;
            asset.InServiceDate = request.InServiceDate;
            asset.Cost = request.Cost;
            asset.ResidualValue = residual;
            asset.UsefulLifeMonths = life;
            asset.OpeningAccumulatedDepreciation = opening;
        }

        asset.Name = name;
        if (!string.IsNullOrEmpty(code)) asset.Code = code;
        asset.SerialNumber = Trimmed(request.SerialNumber, 128);
        asset.Location = Trimmed(request.Location, 128);
        asset.Notes = Trimmed(request.Notes, 2000);
        return null;
    }

    private static string? Trimmed(string? value, int max) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim() is var t && t.Length > max ? t[..max] : value.Trim();

    // ---------------------------------------------------------------- disposal

    // Removes the asset from the books: Cr asset at cost, Dr accumulated depreciation, Dr the
    // proceeds account, and the difference to gain on sale (420300) or loss (661500). Post the
    // depreciation up to the disposal month first; a run after that month blocks the disposal.
    [HttpPost("{id:guid}/dispose", Name = "DisposeFixedAsset")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Accounting, approve: true)]
    public async Task<ActionResult<FixedAssetResponse>> Dispose(Guid companyId, Guid id, DisposeFixedAssetRequest request)
    {
        var asset = await _db.FixedAssets.FirstOrDefaultAsync(a => a.Id == id && a.CompanyId == companyId);
        if (asset is null) return NotFound();
        if (asset.Status != FixedAssetStatus.Active) return BadRequest(L("FixedAssetNotActive"));
        if (request.Date < asset.AcquisitionDate) return BadRequest(L("FixedAssetDisposalDateInvalid"));

        var proceeds = request.Proceeds ?? 0m;
        if (proceeds < 0m || proceeds != Math.Round(proceeds, 2)) return BadRequest(L("FixedAssetAmountsInvalid"));

        var posted = await PostedLinesAsync(new[] { asset.Id });
        var disposalMonth = StraightLineDepreciation.MonthOf(request.Date);
        if (posted.Any(p => p.Period > disposalMonth)) return BadRequest(L("FixedAssetDisposalAfterDepreciation"));

        var category = await _db.AssetCategories.AsNoTracking().FirstAsync(c => c.Id == asset.CategoryId);
        var accumulated = StraightLineDepreciation.Accumulated(asset.OpeningAccumulatedDepreciation, posted.Select(p => p.Amount));
        var (_, gain, loss) = StraightLineDepreciation.Disposal(asset.Cost, accumulated, proceeds);

        Account? proceedsAccount = null;
        if (proceeds > 0m)
        {
            proceedsAccount = await _db.Accounts.AsNoTracking().FirstOrDefaultAsync(a => a.Id == request.ProceedsAccountId && a.CompanyId == companyId);
            if (proceedsAccount is null || !proceedsAccount.IsActive || !proceedsAccount.IsPostable) return BadRequest(L("FixedAssetProceedsAccountInvalid"));
        }

        var resultCodes = new[] { GainOnDisposalCode, LossOnDisposalCode };
        var resultAccounts = await _db.Accounts.AsNoTracking()
            .Where(a => a.CompanyId == companyId && resultCodes.Contains(a.Code)).ToDictionaryAsync(a => a.Code, a => a.Id);
        if ((gain > 0m && !resultAccounts.ContainsKey(GainOnDisposalCode)) || (loss > 0m && !resultAccounts.ContainsKey(LossOnDisposalCode)))
        {
            return BadRequest(string.Format(L("FixedAssetGainLossAccountMissing"), gain > 0m ? GainOnDisposalCode : LossOnDisposalCode));
        }

        if (accumulated > 0m && category.AccumulatedDepreciationAccountId is null) return BadRequest(L("AssetCategoryDepreciationAccountsRequired"));

        var description = $"{asset.Code} {asset.Name}";
        var lines = new List<JournalEntryLine>
        {
            new() { Id = Guid.NewGuid(), AccountId = category.AssetAccountId, Credit = asset.Cost, Description = description }
        };
        if (accumulated > 0m) lines.Add(new() { Id = Guid.NewGuid(), AccountId = category.AccumulatedDepreciationAccountId!.Value, Debit = accumulated, Description = description });
        if (proceedsAccount is not null) lines.Add(new() { Id = Guid.NewGuid(), AccountId = proceedsAccount.Id, Debit = proceeds, Description = description });
        if (gain > 0m) lines.Add(new() { Id = Guid.NewGuid(), AccountId = resultAccounts[GainOnDisposalCode], Credit = gain, Description = description });
        if (loss > 0m) lines.Add(new() { Id = Guid.NewGuid(), AccountId = resultAccounts[LossOnDisposalCode], Debit = loss, Description = description });

        await using var transaction = _db.Database.SupportsRowLocking() ? await _db.Database.BeginTransactionAsync() : null;
        var entry = await PostEntryAsync(companyId, request.Date, $"{L("FixedAssetDisposalReference")} {asset.Code}", asset.Id, lines);
        if (entry.Error is not null) return BadRequest(entry.Error);

        asset.Status = FixedAssetStatus.Disposed;
        asset.DisposedOn = request.Date;
        asset.DisposalProceeds = proceeds;
        asset.DisposalJournalEntryId = entry.Entry!.Id;
        await _db.SaveChangesAsync();
        if (transaction is not null) await transaction.CommitAsync();
        return Ok((await AssetResponsesAsync(new() { asset })).Single());
    }

    // ---------------------------------------------------------------- depreciation runs

    [HttpGet("depreciation-runs", Name = "ListDepreciationRuns")]
    [RequireCompanyAccess(module: AccessModule.Accounting)]
    public async Task<ActionResult<List<DepreciationRunResponse>>> ListRuns(Guid companyId)
    {
        var runs = await _db.DepreciationRuns.AsNoTracking().Where(r => r.CompanyId == companyId)
            .OrderByDescending(r => r.Period).ThenByDescending(r => r.PostedAt)
            .Select(r => new DepreciationRunResponse(r.Id, r.Period, r.State.ToString(), r.Total, r.Lines.Count, r.JournalEntryId, r.ReversalJournalEntryId, r.PostedAt))
            .Take(240)
            .ToListAsync();
        return Ok(runs);
    }

    // What a run for the month would post, per asset and per category. Nothing is saved.
    [HttpGet("depreciation-runs/preview", Name = "PreviewDepreciationRun")]
    [RequireCompanyAccess(module: AccessModule.Accounting)]
    public async Task<ActionResult<DepreciationPreviewResponse>> PreviewRun(Guid companyId, [FromQuery] DateOnly period)
    {
        return Ok(await BuildPreviewAsync(companyId, StraightLineDepreciation.MonthOf(period)));
    }

    // Posts one month: one journal entry dated the last day of the month on the General journal,
    // Dr depreciation expense / Cr accumulated depreciation per category. Months go forward; a month
    // already posted, or one before the last posted month, is refused.
    [HttpPost("depreciation-runs", Name = "PostDepreciationRun")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Accounting, approve: true)]
    [ProducesResponseType(typeof(DepreciationRunResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<DepreciationRunResponse>> PostRun(Guid companyId, PostDepreciationRunRequest request)
    {
        var period = StraightLineDepreciation.MonthOf(request.Period);
        await using var transaction = _db.Database.SupportsRowLocking() ? await _db.Database.BeginTransactionAsync() : null;
        if (_db.Database.SupportsRowLocking())
        {
            // Serialises two runs of the same company (the filtered unique index is the backstop).
            await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT \"Id\" FROM companies WHERE \"Id\" = {companyId} FOR UPDATE");
        }

        var preview = await BuildPreviewAsync(companyId, period);
        if (preview.AlreadyPosted) return BadRequest(L("DepreciationPeriodAlreadyPosted"));
        if (preview.LastPostedPeriod is { } last && period < last) return BadRequest(L("DepreciationPeriodNotAfterLast"));
        if (preview.Lines.Count == 0) return BadRequest(L("DepreciationNothingToPost"));

        var categories = await _db.AssetCategories.AsNoTracking().Where(c => c.CompanyId == companyId).ToDictionaryAsync(c => c.Id);
        var reference = $"{L("DepreciationEntryReference")} {period:yyyy-MM}";
        var lines = new List<JournalEntryLine>();
        foreach (var total in preview.Categories)
        {
            var category = categories[total.CategoryId];
            var description = $"{reference} · {category.Name}";
            lines.Add(new() { Id = Guid.NewGuid(), AccountId = category.DepreciationExpenseAccountId!.Value, Debit = total.Amount, Description = description });
            lines.Add(new() { Id = Guid.NewGuid(), AccountId = category.AccumulatedDepreciationAccountId!.Value, Credit = total.Amount, Description = description });
        }

        var run = new DepreciationRun
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            Period = period,
            Total = preview.Total,
            PostedByUserId = CurrentUserId,
            Lines = preview.Lines.Select(l => new DepreciationRunLine { Id = Guid.NewGuid(), FixedAssetId = l.FixedAssetId, Amount = l.Amount }).ToList()
        };

        var entry = await PostEntryAsync(companyId, period.AddMonths(1).AddDays(-1), reference, run.Id, lines);
        if (entry.Error is not null) return BadRequest(entry.Error);
        run.JournalEntryId = entry.Entry!.Id;
        _db.DepreciationRuns.Add(run);
        try
        {
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateException ex) when (ex.InnerException is Npgsql.PostgresException { SqlState: "23505" })
        {
            return BadRequest(L("DepreciationPeriodAlreadyPosted"));
        }

        if (transaction is not null) await transaction.CommitAsync();
        return StatusCode(StatusCodes.Status201Created,
            new DepreciationRunResponse(run.Id, run.Period, run.State.ToString(), run.Total, run.Lines.Count, run.JournalEntryId, null, run.PostedAt));
    }

    // Reverses the latest posted run with a storno entry (same date unless given) and reopens its
    // month. An earlier run can only be reversed after the later ones.
    [HttpPost("depreciation-runs/{runId:guid}/reverse", Name = "ReverseDepreciationRun")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Accounting, approve: true)]
    public async Task<ActionResult<DepreciationRunResponse>> ReverseRun(Guid companyId, Guid runId, [FromQuery] DateOnly? date = null)
    {
        var run = await _db.DepreciationRuns.Include(r => r.Lines).FirstOrDefaultAsync(r => r.Id == runId && r.CompanyId == companyId);
        if (run is null) return NotFound();
        if (run.State != DepreciationRunState.Posted) return BadRequest(L("DepreciationRunAlreadyReversed"));
        if (await _db.DepreciationRuns.AnyAsync(r => r.CompanyId == companyId && r.State == DepreciationRunState.Posted && r.Period > run.Period))
        {
            return BadRequest(L("DepreciationRunNotLatest"));
        }

        var assetIds = run.Lines.Select(l => l.FixedAssetId).ToList();
        if (await _db.FixedAssets.AnyAsync(a => assetIds.Contains(a.Id) && a.Status == FixedAssetStatus.Disposed))
        {
            return BadRequest(L("DepreciationRunHasDisposedAsset"));
        }

        var company = await _db.Companies.FirstAsync(c => c.Id == companyId);
        var original = await _db.JournalEntries.Include(e => e.Lines).FirstAsync(e => e.Id == run.JournalEntryId);
        var journal = await _db.Journals.FirstAsync(j => j.Id == original.JournalId);
        JournalEntry reversal;
        try
        {
            reversal = original.Reverse(await AccountLockService.GetEffectiveCompanyAsync(_db, company, CurrentUserId), date ?? original.Date);
        }
        catch (Exception ex) when (ex is InvalidOperationException or AccountingLockDateViolationException
                                       or TaxLockDateViolationException or HardLockDateViolationException)
        {
            return BadRequest(ex.Message);
        }

        reversal.PostedByUserId = CurrentUserId;
        reversal.SourceDocumentId = run.Id;
        reversal.SequenceNumber = JournalSequencer.ReserveNext(journal);
        _db.JournalEntries.Add(reversal);
        run.State = DepreciationRunState.Reversed;
        run.ReversalJournalEntryId = reversal.Id;
        await _db.SaveChangesAsync();
        return Ok(new DepreciationRunResponse(run.Id, run.Period, run.State.ToString(), run.Total, run.Lines.Count, run.JournalEntryId, run.ReversalJournalEntryId, run.PostedAt));
    }

    private async Task<DepreciationPreviewResponse> BuildPreviewAsync(Guid companyId, DateOnly period)
    {
        var runs = await _db.DepreciationRuns.AsNoTracking()
            .Where(r => r.CompanyId == companyId && r.State == DepreciationRunState.Posted)
            .Select(r => r.Period).ToListAsync();
        DateOnly? lastPosted = runs.Count == 0 ? null : runs.Max();
        var alreadyPosted = runs.Contains(period);

        var categories = await _db.AssetCategories.AsNoTracking()
            .Where(c => c.CompanyId == companyId && c.IsDepreciable).ToDictionaryAsync(c => c.Id);
        var categoryIds = categories.Keys.ToList();
        var assets = await _db.FixedAssets.AsNoTracking()
            .Where(a => a.CompanyId == companyId && a.Status == FixedAssetStatus.Active && categoryIds.Contains(a.CategoryId) && a.InServiceDate < period)
            .OrderBy(a => a.Code).ToListAsync();
        var posted = (await PostedLinesAsync(assets.Select(a => a.Id))).ToLookup(p => p.AssetId);

        var lines = new List<DepreciationPreviewLine>();
        if (!alreadyPosted)
        {
            foreach (var asset in assets)
            {
                var accumulated = StraightLineDepreciation.Accumulated(asset.OpeningAccumulatedDepreciation, posted[asset.Id].Select(p => p.Amount));
                var amount = StraightLineDepreciation.AmountFor(asset.Cost, asset.ResidualValue, asset.UsefulLifeMonths, asset.InServiceDate, period, accumulated);
                if (amount == 0m) continue;
                var after = accumulated + amount;
                lines.Add(new DepreciationPreviewLine(asset.Id, asset.Code, asset.Name, categories[asset.CategoryId].Name, amount, after,
                    StraightLineDepreciation.BookValue(asset.Cost, after)));
            }
        }

        var accountIds = categories.Values.SelectMany(c => new[] { c.AccumulatedDepreciationAccountId, c.DepreciationExpenseAccountId }).OfType<Guid>().ToList();
        var codes = await _db.Accounts.AsNoTracking().Where(a => accountIds.Contains(a.Id)).ToDictionaryAsync(a => a.Id, a => a.Code);
        var assetCategory = assets.ToDictionary(a => a.Id, a => a.CategoryId);
        var totals = lines.GroupBy(l => assetCategory[l.FixedAssetId])
            .Select(g =>
            {
                var c = categories[g.Key];
                return new DepreciationCategoryTotal(c.Id, c.Name, codes.GetValueOrDefault(c.DepreciationExpenseAccountId!.Value, string.Empty),
                    codes.GetValueOrDefault(c.AccumulatedDepreciationAccountId!.Value, string.Empty), g.Sum(l => l.Amount));
            })
            .OrderBy(t => t.ExpenseAccountCode).ToList();
        return new DepreciationPreviewResponse(period, lastPosted, alreadyPosted, lines.Sum(l => l.Amount), lines, totals);
    }

    // ---------------------------------------------------------------- year-end schedule

    [HttpGet("schedule", Name = "FixedAssetSchedule")]
    [RequireCompanyAccess(module: AccessModule.Accounting)]
    public async Task<ActionResult<FixedAssetScheduleResponse>> Schedule(Guid companyId, [FromQuery] int year)
    {
        if (year is < 1900 or > 2999) return BadRequest(L("ReportDateRangeInvalid"));
        var yearEnd = new DateOnly(year, 12, 31);
        var yearStart = new DateOnly(year, 1, 1);
        var assets = await _db.FixedAssets.AsNoTracking()
            .Where(a => a.CompanyId == companyId && a.AcquisitionDate <= yearEnd && (a.DisposedOn == null || a.DisposedOn >= yearStart))
            .OrderBy(a => a.Code).ToListAsync();
        var categories = await _db.AssetCategories.AsNoTracking().Where(c => c.CompanyId == companyId).ToDictionaryAsync(c => c.Id, c => c.Name);
        var posted = (await PostedLinesAsync(assets.Select(a => a.Id))).ToLookup(p => p.AssetId);

        var lines = new List<FixedAssetScheduleLine>();
        foreach (var asset in assets)
        {
            var amounts = FixedAssetRollForward.ForYear(year, asset.AcquisitionDate, asset.DisposedOn, asset.Cost, asset.OpeningAccumulatedDepreciation,
                posted[asset.Id].Select(p => (p.Period, p.Amount)));
            if (amounts is null) continue;
            lines.Add(new FixedAssetScheduleLine(asset.Id, asset.Code, asset.Name, categories.GetValueOrDefault(asset.CategoryId, string.Empty), ToContract(amounts)));
        }

        var byCategory = lines.GroupBy(l => l.CategoryName).OrderBy(g => g.Key)
            .Select(g => new FixedAssetScheduleCategory(g.Key, ToContract(AssetYearAmounts.Sum(g.Select(l => FromContract(l.Amounts))))))
            .ToList();
        var total = ToContract(AssetYearAmounts.Sum(lines.Select(l => FromContract(l.Amounts))));
        return Ok(new FixedAssetScheduleResponse(year, lines, byCategory, total));
    }

    [ProducesXlsx]
    [EnableRateLimiting(AuthRateLimit.ExcelExportPolicy)]
    [HttpGet("schedule/export", Name = "FixedAssetScheduleExport")]
    [RequireCompanyAccess(module: AccessModule.Accounting)]
    public async Task<IActionResult> ScheduleExport(Guid companyId, [FromQuery] int year)
    {
        var result = await Schedule(companyId, year);
        if (result.Result is not OkObjectResult { Value: FixedAssetScheduleResponse schedule }) return result.Result!;

        var headers = new[]
        {
            _labels["Fa_Code"], _labels["Fa_Name"], _labels["Fa_Category"], _labels["Fa_CostOpening"], _labels["Fa_Additions"], _labels["Fa_CostDisposed"],
            _labels["Fa_CostClosing"], _labels["Fa_AccumulatedOpening"], _labels["Fa_Depreciation"], _labels["Fa_AccumulatedDisposed"],
            _labels["Fa_AccumulatedClosing"], _labels["Fa_BookValueOpening"], _labels["Fa_BookValueClosing"]
        };
        static object?[] Row(string? code, string name, string? category, FixedAssetScheduleAmounts a) => new object?[]
        {
            code, name, category, a.CostOpening, a.Additions, a.CostDisposed, a.CostClosing, a.AccumulatedOpening, a.Depreciation,
            a.AccumulatedDisposed, a.AccumulatedClosing, a.BookValueOpening, a.BookValueClosing
        };

        var rows = new List<IReadOnlyList<object?>>();
        foreach (var category in schedule.Categories)
        {
            rows.AddRange(schedule.Lines.Where(l => l.CategoryName == category.CategoryName).Select(l => Row(l.Code, l.Name, l.CategoryName, l.Amounts)));
            rows.Add(Row(null, string.Format(_labels["Tb_TotalGroup"], category.CategoryName), null, category.Amounts));
        }

        rows.Add(Row(null, _labels["Common_Total"], null, schedule.Total));
        var bytes = ExcelExportService.BuildWorkbook(_labels["Sheet_FixedAssetSchedule"], headers, rows);
        return File(bytes, ExcelExportService.XlsxContentType, $"fixed-asset-schedule-{year}.xlsx");
    }

    private static FixedAssetScheduleAmounts ToContract(AssetYearAmounts a) => new(a.CostOpening, a.Additions, a.CostDisposed, a.CostClosing,
        a.AccumulatedOpening, a.Depreciation, a.AccumulatedDisposed, a.AccumulatedClosing, a.BookValueOpening, a.BookValueClosing);

    private static AssetYearAmounts FromContract(FixedAssetScheduleAmounts a) => new(a.CostOpening, a.Additions, a.CostDisposed, a.CostClosing,
        a.AccumulatedOpening, a.Depreciation, a.AccumulatedDisposed, a.AccumulatedClosing, a.BookValueOpening, a.BookValueClosing);

    // ---------------------------------------------------------------- shared

    private sealed record PostedLine(Guid AssetId, DateOnly Period, decimal Amount);

    // Depreciation of posted (not reversed) runs.
    private async Task<List<PostedLine>> PostedLinesAsync(IEnumerable<Guid> assetIds)
    {
        var ids = assetIds.ToList();
        return await (from l in _db.DepreciationRunLines.AsNoTracking()
                      join r in _db.DepreciationRuns.AsNoTracking() on l.DepreciationRunId equals r.Id
                      where ids.Contains(l.FixedAssetId) && r.State == DepreciationRunState.Posted
                      select new PostedLine(l.FixedAssetId, r.Period, l.Amount)).ToListAsync();
    }

    private async Task<(JournalEntry? Entry, string? Error)> PostEntryAsync(Guid companyId, DateOnly date, string reference, Guid sourceId, List<JournalEntryLine> lines)
    {
        var journal = await JournalResolver.GetAsync(_db, companyId, JournalType.General);
        if (journal is null) return (null, L("NoJournalToPost"));
        var company = await _db.Companies.FirstAsync(c => c.Id == companyId);
        var entry = new JournalEntry
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            JournalId = journal.Id,
            Date = date,
            Reference = reference,
            SourceDocumentId = sourceId,
            Lines = lines
        };

        try
        {
            entry.Post(await AccountLockService.GetEffectiveCompanyAsync(_db, company, CurrentUserId));
        }
        catch (Exception ex) when (ex is InvalidOperationException or UnbalancedJournalEntryException or AccountingLockDateViolationException
                                       or TaxLockDateViolationException or HardLockDateViolationException)
        {
            return (null, ex.Message);
        }

        entry.PostedByUserId = CurrentUserId;
        entry.SequenceNumber = JournalSequencer.ReserveNext(journal);
        _db.JournalEntries.Add(entry);
        return (entry, null);
    }

    private async Task<List<FixedAssetResponse>> AssetResponsesAsync(List<FixedAsset> assets)
    {
        var categoryIds = assets.Select(a => a.CategoryId).Distinct().ToList();
        var categories = await _db.AssetCategories.AsNoTracking().Where(c => categoryIds.Contains(c.Id)).ToDictionaryAsync(c => c.Id);
        var posted = (await PostedLinesAsync(assets.Select(a => a.Id))).ToLookup(p => p.AssetId);
        var assetIds = assets.Select(a => a.Id).ToList();
        var withAnyRun = (await _db.DepreciationRunLines.AsNoTracking().Where(l => assetIds.Contains(l.FixedAssetId))
            .Select(l => l.FixedAssetId).Distinct().ToListAsync()).ToHashSet();

        return assets.Select(a =>
        {
            var category = categories.GetValueOrDefault(a.CategoryId);
            var mine = posted[a.Id].ToList();
            var accumulated = StraightLineDepreciation.Accumulated(a.OpeningAccumulatedDepreciation, mine.Select(p => p.Amount));
            var depreciable = category?.IsDepreciable ?? false;
            return new FixedAssetResponse(a.Id, a.Code, a.Name, a.CategoryId, category?.Name ?? string.Empty, depreciable, a.AcquisitionDate, a.InServiceDate,
                a.Cost, a.ResidualValue, a.UsefulLifeMonths, a.OpeningAccumulatedDepreciation, accumulated,
                StraightLineDepreciation.BookValue(a.Cost, accumulated),
                depreciable ? StraightLineDepreciation.MonthlyAmount(a.Cost, a.ResidualValue, a.UsefulLifeMonths) : 0m,
                mine.Count == 0 ? null : mine.Max(p => p.Period),
                depreciable && StraightLineDepreciation.IsFullyDepreciated(a.Cost, a.ResidualValue, accumulated),
                a.Status.ToString(), a.DisposedOn, a.DisposalProceeds, a.DisposalJournalEntryId,
                withAnyRun.Contains(a.Id) || a.Status == FixedAssetStatus.Disposed, a.SerialNumber, a.Location, a.Notes);
        }).ToList();
    }
}
