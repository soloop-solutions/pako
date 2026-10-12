using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Tax;
using Pako.Infrastructure;
using Pako.Localization.Xk;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId:guid}/withholding-tax")]
[Authorize]
public class WithholdingTaxController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public WithholdingTaxController(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _localizer = localizer;
    }

    [HttpGet]
    [RequireCompanyAccess]
    public async Task<ActionResult<WithholdingTaxListResponse>> List(
        Guid companyId,
        [FromQuery] int year,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        [FromQuery] string? search = null,
        [FromQuery] string? sort = null)
    {
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 200);

        var yearEntries = _db.WithholdingTaxEntries.AsNoTracking()
            .Where(e => e.CompanyId == companyId && e.Year == year);

        var query = yearEntries;
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            query = query.Where(e => EF.Functions.ILike(e.Name, $"%{term}%") || e.PersonalNumber.Contains(term));
        }

        var descending = sort is not null && sort.StartsWith('-');
        var sortField = descending ? sort![1..] : sort;
        query = sortField?.ToLowerInvariant() switch
        {
            "personalnumber" => descending ? query.OrderByDescending(e => e.PersonalNumber) : query.OrderBy(e => e.PersonalNumber),
            _ => descending ? query.OrderByDescending(e => e.Name) : query.OrderBy(e => e.Name)
        };

        var total = await query.CountAsync();
        var entries = await query.Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        var allEntries = await yearEntries.ToListAsync();

        var standardRate = WithholdingDeclarationRates.Standard;
        var nonResidentRate = WithholdingDeclarationRates.NonResident;
        var totals = WithholdingTaxTotals.Of(allEntries, standardRate, nonResidentRate);

        return Ok(new WithholdingTaxListResponse(
            entries.Select(e => ToResponse(e, standardRate, nonResidentRate)).ToList(),
            total, page, pageSize, ToResponse(totals), standardRate, nonResidentRate));
    }

    [HttpGet("countries")]
    [RequireCompanyAccess]
    public ActionResult<WithholdingTaxCountryListResponse> Countries(Guid companyId) =>
        Ok(new WithholdingTaxCountryListResponse(AtkCountries.Names.ToList(), AtkCountries.Default));

    [HttpGet("{entryId:guid}")]
    [RequireCompanyAccess]
    public async Task<ActionResult<WithholdingTaxEntryResponse>> Get(Guid companyId, Guid entryId)
    {
        var entry = await _db.WithholdingTaxEntries.AsNoTracking()
            .FirstOrDefaultAsync(e => e.Id == entryId && e.CompanyId == companyId);

        if (entry is null) return NotFound();
        return Ok(ToResponse(entry, WithholdingDeclarationRates.Standard, WithholdingDeclarationRates.NonResident));
    }

    [HttpPost]
    [RequireCompanyAccess(writeAccess: true)]
    [ProducesResponseType(typeof(WithholdingTaxEntryResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<WithholdingTaxEntryResponse>> Create(Guid companyId, SaveWithholdingTaxEntryRequest request)
    {
        var error = Validate(request);
        if (error is not null) return BadRequest(_localizer[error].Value);

        var entry = new WithholdingTaxEntry { Id = Guid.NewGuid(), CompanyId = companyId };
        Apply(entry, request);

        _db.WithholdingTaxEntries.Add(entry);
        await _db.SaveChangesAsync();

        return StatusCode(StatusCodes.Status201Created,
            ToResponse(entry, WithholdingDeclarationRates.Standard, WithholdingDeclarationRates.NonResident));
    }

    [HttpPut("{entryId:guid}")]
    [RequireCompanyAccess(writeAccess: true)]
    public async Task<ActionResult<WithholdingTaxEntryResponse>> Update(Guid companyId, Guid entryId, SaveWithholdingTaxEntryRequest request)
    {
        var entry = await _db.WithholdingTaxEntries.FirstOrDefaultAsync(e => e.Id == entryId && e.CompanyId == companyId);
        if (entry is null) return NotFound();

        var error = Validate(request);
        if (error is not null) return BadRequest(_localizer[error].Value);

        Apply(entry, request);
        entry.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(ToResponse(entry, WithholdingDeclarationRates.Standard, WithholdingDeclarationRates.NonResident));
    }

    [HttpDelete("{entryId:guid}")]
    [RequireCompanyAccess(writeAccess: true)]
    public async Task<IActionResult> Delete(Guid companyId, Guid entryId)
    {
        var entry = await _db.WithholdingTaxEntries.FirstOrDefaultAsync(e => e.Id == entryId && e.CompanyId == companyId);
        if (entry is null) return NotFound();

        _db.WithholdingTaxEntries.Remove(entry);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [Produces(ExcelExportService.XlsxContentType)]
    [HttpGet("export", Name = "WithholdingTaxExport")]
    [RequireCompanyAccess]
    public async Task<IActionResult> Export(Guid companyId, [FromQuery] int year)
    {
        var entries = await _db.WithholdingTaxEntries.AsNoTracking()
            .Where(e => e.CompanyId == companyId && e.Year == year)
            .OrderBy(e => e.Name)
            .ToListAsync();

        var bytes = WithholdingTaxExportService.BuildWorkbook(
            entries, WithholdingDeclarationRates.Standard, WithholdingDeclarationRates.NonResident);
        return File(bytes, ExcelExportService.XlsxContentType, $"tatimi-ne-burim-{year}.xlsx");
    }

    private static string? Validate(SaveWithholdingTaxEntryRequest r)
    {
        if (r.Year is < 2000 or > 2100) return "WithholdingTaxYearInvalid";
        if (string.IsNullOrWhiteSpace(r.PersonalNumber)) return "WithholdingTaxPersonalNumberRequired";
        if (string.IsNullOrWhiteSpace(r.Name)) return "WithholdingTaxNameRequired";

        var amounts = new[]
        {
            r.GrossInterest, r.PropertyRights, r.LotteryWinnings, r.GrossRent, r.NonResidentEntertainer,
            r.NonResidentServices, r.NonEntrepreneur, r.RentalAreaM2 ?? 0m, r.MonthlyGrossRent ?? 0m
        };
        if (amounts.Any(a => a < 0)) return "WithholdingTaxAmountsMustBeNonNegative";

        if (r.GrossRent > 0 && ((r.RentalAreaM2 ?? 0m) <= 0 || (r.MonthlyGrossRent ?? 0m) <= 0))
        {
            return "WithholdingTaxRentDetailsRequired";
        }

        if (!string.IsNullOrWhiteSpace(r.Country) && !AtkCountries.IsKnown(r.Country.Trim()))
        {
            return "WithholdingTaxCountryUnknown";
        }

        return null;
    }

    private static void Apply(WithholdingTaxEntry entry, SaveWithholdingTaxEntryRequest r)
    {
        entry.Year = r.Year;
        entry.PersonalNumber = r.PersonalNumber.Trim();
        entry.Name = r.Name.Trim();
        entry.GrossInterest = r.GrossInterest;
        entry.PropertyRights = r.PropertyRights;
        entry.LotteryWinnings = r.LotteryWinnings;
        entry.GrossRent = r.GrossRent;
        entry.NonResidentEntertainer = r.NonResidentEntertainer;
        entry.NonResidentServices = r.NonResidentServices;
        entry.NonEntrepreneur = r.NonEntrepreneur;
        entry.RentalAreaM2 = r.GrossRent > 0 ? r.RentalAreaM2 : null;
        entry.MonthlyGrossRent = r.GrossRent > 0 ? r.MonthlyGrossRent : null;
        entry.Country = string.IsNullOrWhiteSpace(r.Country) ? AtkCountries.Default : r.Country.Trim();
    }

    private static WithholdingTaxEntryResponse ToResponse(WithholdingTaxEntry e, decimal standardRate, decimal nonResidentRate) => new(
        e.Id, e.Year, e.PersonalNumber, e.Name, e.GrossInterest, e.PropertyRights, e.LotteryWinnings,
        e.WithheldTax(standardRate), e.GrossRent, e.NonResidentEntertainer, e.NonResidentServices,
        e.NonResidentWithheldTax(nonResidentRate), e.NonEntrepreneur, e.RentalAreaM2, e.MonthlyGrossRent, e.Country);

    private static WithholdingTaxTotalsResponse ToResponse(WithholdingTaxTotals t) => new(
        t.GrossInterest, t.PropertyRights, t.LotteryWinnings, t.WithheldTax, t.GrossRent,
        t.NonResidentEntertainer, t.NonResidentServices, t.NonResidentWithheldTax, t.NonEntrepreneur);
}
