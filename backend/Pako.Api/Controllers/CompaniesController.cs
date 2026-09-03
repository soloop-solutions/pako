using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
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
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public CompaniesController(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _localizer = localizer;
    }

    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpPost]
    [ProducesResponseType(typeof(CompanyResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<CompanyResponse>> Create(CreateCompanyRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return BadRequest(_localizer["CompanyNameRequired"].Value);
        }

        if (request.Name.Length > 256)
        {
            return BadRequest(_localizer["CompanyNameTooLong"].Value);
        }

        if (request.FirmId is Guid firmId)
        {
            var firm = await _db.Firms.AsNoTracking().FirstOrDefaultAsync(f => f.Id == firmId);
            if (firm is null)
            {
                return NotFound(string.Format(_localizer["FirmNotFound"], firmId));
            }

            var isFirmAdmin = await _db.Memberships.AsNoTracking()
                .AnyAsync(m => m.UserId == CurrentUserId && m.FirmId == firmId && m.Role == MembershipRole.FirmAdmin);
            if (!isFirmAdmin)
            {
                return Forbid();
            }
        }

        var company = new Company
        {
            Id = Guid.NewGuid(),
            Name = request.Name,
            FirmId = request.FirmId,
            EnabledProfiles = (request.EnabledProfiles ?? CompanyProfile.None) | CompanyProfile.Core
        };
        _db.Companies.Add(company);

        // Plani Kontabel v2.0 (COA_V2_IMPLEMENTATION_BRIEF.md Stage 2): a fresh copy of the
        // profile-filtered chart per company, never a shared reference — each Account row below
        // is newly constructed, not a reused entity.
        var accountIdsByCode = new Dictionary<string, Guid>();
        foreach (var entry in ChartOfAccountsV2Template.ForProfiles(company.EnabledProfiles))
        {
            var accountId = Guid.NewGuid();
            accountIdsByCode[entry.Code] = accountId;
            _db.Accounts.Add(new Account
            {
                Id = accountId,
                CompanyId = company.Id,
                Code = entry.Code,
                Name = entry.NameEn,
                AccountType = AccountTypeDerivation.DeriveAccountType(entry.Class, entry.NormalBalance),
                AccountSubType = AccountTypeDerivation.DeriveAccountSubType(entry.Subledger),
                NameSq = entry.NameSq,
                Class = entry.Class,
                Group = entry.Group,
                Statement = entry.Statement,
                NormalBalance = entry.NormalBalance,
                Subledger = entry.Subledger,
                IsControl = ChartOfAccountsV2Template.ControlAccountCodes.Contains(entry.Code),
                DefaultVatCode = entry.DefaultVatCode,
                CitDeductibility = entry.CitDeductibility,
                CitLimitRule = entry.CitLimitRule,
                Profiles = entry.Profile
            });
        }

        // Plani Kontabel v2.0 (COA_V2_IMPLEMENTATION_BRIEF.md Stage 3): the real 20 VAT codes +
        // 6 withholding codes from 20_VAT_Codes/21_WHT_Codes, replacing the old 5-entry
        // DefaultTaxDefinitionsTemplate seed (kept only for tests that still reference it
        // directly, same pattern as DefaultChartOfAccountsTemplate in Stage 2).
        foreach (var taxDefinition in VatWithholdingTemplate.CreateTaxDefinitions(company.Id, accountIdsByCode))
        {
            _db.TaxDefinitions.Add(taxDefinition);
        }

        // Replaces the old lookup-by-literal-code pattern (DefaultChartOfAccountsTemplate.
        // AccountsReceivableCode == "1200", etc.), which broke once codes became 6 digits — see
        // CompanyAccountDefaults' own doc comment for why the payroll fields are conditional.
        var accountDefaults = new CompanyAccountDefaults
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            ReceivableAccountId = accountIdsByCode["110100"],
            PayableAccountId = accountIdsByCode["200100"],
            RevenueAccountId = accountIdsByCode["400100"],
            ExpenseAccountId = accountIdsByCode["661200"],
            CustomerDepositsAccountId = accountIdsByCode["240300"],
            ReverseChargeInputVatAccountId = accountIdsByCode["113300"],
            ReverseChargeOutputVatAccountId = accountIdsByCode["210300"]
        };

        if (company.EnabledProfiles.HasFlag(CompanyProfile.Payroll))
        {
            accountDefaults.SalaryExpenseAccountId = accountIdsByCode["600100"];
            accountDefaults.PitPayableAccountId = accountIdsByCode["213100"];
            accountDefaults.PensionPayableAccountId = accountIdsByCode["221100"];
            accountDefaults.NetPayPayableAccountId = accountIdsByCode["220100"];
        }

        _db.CompanyAccountDefaults.Add(accountDefaults);

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
        new(c.Id, c.Name, c.FirmId, c.AccountingLockDate, c.TaxLockDate, c.EnabledProfiles);
}
