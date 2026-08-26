using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Contracts;
using Pako.Domain.Companies;
using Pako.Domain.Ledger;
using Pako.Infrastructure;
using Pako.Localization.Xk;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies")]
[Authorize]
public class CompaniesController : ControllerBase
{
    private readonly PakoDbContext _db;

    public CompaniesController(PakoDbContext db)
    {
        _db = db;
    }

    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpPost]
    [ProducesResponseType(typeof(CompanyResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<CompanyResponse>> Create(CreateCompanyRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return BadRequest("Company name is required.");
        }

        if (request.Name.Length > 256)
        {
            return BadRequest("Company name must be 256 characters or fewer.");
        }

        if (request.FirmId is Guid firmId)
        {
            var firm = await _db.Firms.AsNoTracking().FirstOrDefaultAsync(f => f.Id == firmId);
            if (firm is null)
            {
                return NotFound($"Firm {firmId} not found.");
            }

            var isFirmAdmin = await _db.Memberships.AsNoTracking()
                .AnyAsync(m => m.UserId == CurrentUserId && m.FirmId == firmId && m.Role == MembershipRole.FirmAdmin);
            if (!isFirmAdmin)
            {
                return Forbid();
            }
        }

        var company = new Company { Id = Guid.NewGuid(), Name = request.Name, FirmId = request.FirmId };
        _db.Companies.Add(company);

        var accountIdsByCode = new Dictionary<string, Guid>();
        foreach (var entry in DefaultChartOfAccountsTemplate.Entries)
        {
            var accountId = Guid.NewGuid();
            accountIdsByCode[entry.Code] = accountId;
            _db.Accounts.Add(new Account
            {
                Id = accountId,
                CompanyId = company.Id,
                Code = entry.Code,
                Name = entry.Name,
                AccountType = entry.AccountType,
                AccountSubType = entry.AccountSubType
            });
        }

        foreach (var taxDefinition in DefaultTaxDefinitionsTemplate.CreateDefaultTaxDefinitions(company.Id, accountIdsByCode))
        {
            _db.TaxDefinitions.Add(taxDefinition);
        }

        _db.Journals.Add(new Journal
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            Type = JournalType.General,
            Code = "GEN",
            Name = "General",
            SequencePrefix = "GEN",
            SequenceNextNumber = 1,
            SequencePadding = 4
        });

        if (request.FirmId is null)
        {
            _db.Memberships.Add(Membership.ForCompany(CurrentUserId, company.Id, MembershipRole.ClientAdmin));
        }

        await _db.SaveChangesAsync();

        return StatusCode(StatusCodes.Status201Created, ToResponse(company));
    }

    [HttpGet]
    public async Task<ActionResult<List<CompanyResponse>>> List()
    {
        var userId = CurrentUserId;

        var firmIds = await _db.Memberships.AsNoTracking()
            .Where(m => m.UserId == userId && m.FirmId != null)
            .Select(m => m.FirmId!.Value)
            .ToListAsync();

        var directCompanyIds = await _db.Memberships.AsNoTracking()
            .Where(m => m.UserId == userId && m.CompanyId != null)
            .Select(m => m.CompanyId!.Value)
            .ToListAsync();

        var companies = await _db.Companies.AsNoTracking()
            .Where(c => directCompanyIds.Contains(c.Id) || (c.FirmId != null && firmIds.Contains(c.FirmId.Value)))
            .ToListAsync();

        return Ok(companies.Select(ToResponse).ToList());
    }

    private static CompanyResponse ToResponse(Company c) =>
        new(c.Id, c.Name, c.FirmId, c.AccountingLockDate, c.TaxLockDate);
}
