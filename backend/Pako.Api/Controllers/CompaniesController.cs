using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Companies;
using Pako.Domain.Ledger;
using Pako.Infrastructure;
using Pako.Localization.Xk;
using Pako.Domain.Hr;

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
                .AnyAsync(m => m.UserId == CurrentUserId && m.FirmId == firmId && m.Role == MembershipRole.FirmAdmin && m.IsActive);
            if (!isFirmAdmin)
            {
                return Forbid();
            }
        }

        // docs/PLATFORM_ADMIN.md: each accountant may create only as many companies as a platform
        // administrator allows (null = no limit). Archived companies still count.
        // The count and the insert share one transaction holding a per-user lock, so parallel requests
        // can't each see room for one more company.
        await using var transaction = _db.Database.SupportsRowLocking() ? await _db.Database.BeginTransactionAsync() : null;
        if (transaction is not null)
        {
            await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtext({"company-limit:" + CurrentUserId}))");
        }
        var creator = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == CurrentUserId);
        if (creator is { IsPlatformAdmin: false, CompanyLimit: { } limit }
            && await _db.Companies.CountAsync(c => c.CreatedByUserId == CurrentUserId) >= limit)
        {
            return StatusCode(StatusCodes.Status403Forbidden, string.Format(_localizer["CompanyLimitReached"].Value, limit));
        }

        var company = new Company
        {
            Id = Guid.NewGuid(),
            Name = request.Name,
            FirmId = request.FirmId,
            EnabledProfiles = (request.EnabledProfiles ?? CompanyProfile.None) | CompanyProfile.Core,
            IsVatRegistered = request.IsVatRegistered ?? true,
            Country = "Kosovo",
            CreatedByUserId = CurrentUserId
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
                AccountType = AccountTypeDerivation.DeriveAccountType(entry.Code, entry.Class, entry.Group, entry.NormalBalance),
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
                Profiles = entry.Profile,
                CashFlowCategory = AccountTypeDerivation.DeriveCashFlowCategory(entry.Class, entry.Group)
            });
        }

        // B2: hierarchy by code prefix, not a stored parent — every company gets the same 35
        // groups (7 Class-level + 28 Group-level) regardless of which profiles are enabled, since
        // an account's group is resolved by matching its Code against a prefix range at read
        // time, never backfilled.
        _db.AccountGroups.AddRange(AccountGroupTemplate.BuildForCompany(company.Id));

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
            accountDefaults.BonusExpenseAccountId = accountIdsByCode["600300"];
            accountDefaults.EmployerPensionExpenseAccountId = accountIdsByCode["600200"];
            accountDefaults.EmployerPensionPayableAccountId = accountIdsByCode["221200"];
            accountDefaults.PayrollDeductionsAccountId = accountIdsByCode["222100"];
            accountDefaults.EmployeeAdvancesAccountId = accountIdsByCode.GetValueOrDefault("111100") is var advances && advances != Guid.Empty ? advances : null;
        }

        _db.CompanyAccountDefaults.Add(accountDefaults);

        // B9: General stays, for manual journal entries and payroll — Sale/Purchase/Cash/Bank are
        // new, each document type's auto-routed post now asks for its own type explicitly
        // (JournalResolver) instead of grabbing "the first journal for this company", which only
        // ever worked while General was the only one that existed.
        _db.Journals.AddRange(
            new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.General, Code = "GEN", Name = "General", SequencePrefix = "GEN", SequenceNextNumber = 1, SequencePadding = 4 },
            new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.Sale, Code = "SAL", Name = "Sales", SequencePrefix = "SAL", SequenceNextNumber = 1, SequencePadding = 4 },
            new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.Purchase, Code = "PUR", Name = "Purchases", SequencePrefix = "PUR", SequenceNextNumber = 1, SequencePadding = 4 },
            new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.Cash, Code = "CSH", Name = "Cash", SequencePrefix = "CSH", SequenceNextNumber = 1, SequencePadding = 4 },
            new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.Bank, Code = "BNK", Name = "Bank", SequencePrefix = "BNK", SequenceNextNumber = 1, SequencePadding = 4 });

        // Track C4: two starter payment methods so the record-payment/pay-at-creation pickers
        // aren't empty out of the box — "100100 Arka kryesore"/"101003 Banka ProCredit" are both
        // CORE-profile accounts, always seeded, matching the exact example item 28's Done
        // criterion names ("Cash — arka kryesore" / "Bank — ProCredit"). More can be added later
        // via POST .../payment-methods for companies that use a different bank.
        if (accountIdsByCode.TryGetValue("100100", out var cashAccountId))
        {
            _db.PaymentMethods.Add(new PaymentMethod
            {
                Id = Guid.NewGuid(),
                CompanyId = company.Id,
                Name = "Cash — Arka kryesore",
                Kind = PaymentMethodKind.Cash,
                LedgerAccountId = cashAccountId
            });
        }

        if (accountIdsByCode.TryGetValue("101003", out var bankAccountId))
        {
            _db.PaymentMethods.Add(new PaymentMethod
            {
                Id = Guid.NewGuid(),
                CompanyId = company.Id,
                Name = "Bank — ProCredit",
                Kind = PaymentMethodKind.Bank,
                LedgerAccountId = bankAccountId
            });
        }

        if (request.FirmId is null)
        {
            _db.Memberships.Add(Membership.ForCompany(CurrentUserId, company.Id, MembershipRole.ClientAdmin));
        }

        await _db.SaveChangesAsync();
        if (transaction is not null) await transaction.CommitAsync();

        return StatusCode(StatusCodes.Status201Created, ToResponse(company));
    }

    [HttpPut("{companyId:guid}/profile")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Settings)]
    [ProducesResponseType(typeof(CompanyResponse), StatusCodes.Status200OK)]
    public async Task<ActionResult<CompanyResponse>> UpdateProfile(Guid companyId, UpdateCompanyProfileRequest request)
    {
        var company = await _db.Companies.FirstOrDefaultAsync(c => c.Id == companyId);
        if (company is null)
            return NotFound(string.Format(_localizer["CompanyNotFound"], companyId));

        if (company.IsArchived)
            return BadRequest(_localizer["CompanyIsArchived"].Value);

        // Only update non-null fields (partial update)
        if (request.Name is not null)
        {
            if (string.IsNullOrWhiteSpace(request.Name))
                return BadRequest(_localizer["CompanyNameRequired"].Value);
            if (request.Name.Length > 256)
                return BadRequest(_localizer["CompanyNameTooLong"].Value);
            company.Name = request.Name;
        }

        if (request.TradingName is not null) company.TradingName = request.TradingName == "" ? null : request.TradingName;
        if (request.BusinessNumber is not null) company.BusinessNumber = request.BusinessNumber == "" ? null : request.BusinessNumber;
        if (request.FiscalNumber is not null) company.FiscalNumber = request.FiscalNumber == "" ? null : request.FiscalNumber;
        if (request.VatNumber is not null) company.VatNumber = request.VatNumber == "" ? null : request.VatNumber;
        if (request.LegalForm is not null) company.LegalForm = request.LegalForm;
        if (request.BusinessActivity is not null) company.BusinessActivity = request.BusinessActivity == "" ? null : request.BusinessActivity;
        if (request.Description is not null) company.Description = request.Description == "" ? null : request.Description;

        // Address
        if (request.Country is not null) company.Country = request.Country == "" ? null : request.Country;
        if (request.Municipality is not null) company.Municipality = request.Municipality == "" ? null : request.Municipality;
        if (request.StreetAddress is not null) company.StreetAddress = request.StreetAddress == "" ? null : request.StreetAddress;
        if (request.PostalCode is not null) company.PostalCode = request.PostalCode == "" ? null : request.PostalCode;
        if (request.AddressLine2 is not null) company.AddressLine2 = request.AddressLine2 == "" ? null : request.AddressLine2;

        // Contact
        if (request.Email is not null) company.Email = request.Email == "" ? null : request.Email;
        if (request.Phone is not null) company.Phone = request.Phone == "" ? null : request.Phone;
        if (request.Website is not null) company.Website = request.Website == "" ? null : request.Website;

        // Banking
        if (request.BankName is not null) company.BankName = request.BankName == "" ? null : request.BankName;
        if (request.BankAccountHolder is not null) company.BankAccountHolder = request.BankAccountHolder == "" ? null : request.BankAccountHolder;
        if (request.Iban is not null) company.Iban = request.Iban == "" ? null : request.Iban;
        if (request.SwiftBic is not null) company.SwiftBic = request.SwiftBic == "" ? null : request.SwiftBic;

        // Document
        if (request.DocumentFooter is not null) company.DocumentFooter = request.DocumentFooter == "" ? null : request.DocumentFooter;
        if (request.PaymentInstructions is not null) company.PaymentInstructions = request.PaymentInstructions == "" ? null : request.PaymentInstructions;

        // Tax
        if (request.IsVatRegistered is not null) company.IsVatRegistered = request.IsVatRegistered.Value;
        if (request.VatRegistrationDate is not null) company.VatRegistrationDate = request.VatRegistrationDate;

        await _db.SaveChangesAsync();
        return Ok(ToResponse(company));
    }

    [HttpGet]
    public async Task<ActionResult<List<CompanyResponse>>> List([FromQuery] bool includeArchived = false)
    {
        var userId = CurrentUserId;

        var firmIds = await _db.Memberships.AsNoTracking()
            .Where(m => m.UserId == userId && m.FirmId != null && m.IsActive)
            .Select(m => m.FirmId!.Value)
            .ToListAsync();

        var directCompanyIds = await _db.Memberships.AsNoTracking()
            .Where(m => m.UserId == userId && m.CompanyId != null && m.IsActive)
            .Select(m => m.CompanyId!.Value)
            .ToListAsync();

        var query = _db.Companies.AsNoTracking()
            .Where(c => directCompanyIds.Contains(c.Id) || (c.FirmId != null && firmIds.Contains(c.FirmId.Value)));

        if (!includeArchived)
            query = query.Where(c => !c.IsArchived);

        var companies = await query.ToListAsync();

        return Ok(companies.Select(ToResponse).ToList());
    }

    [HttpPost("{companyId:guid}/archive")]
    [RequireCompanyAccess(adminOnly: true)]
    [ProducesResponseType(typeof(CompanyResponse), StatusCodes.Status200OK)]
    public async Task<ActionResult<CompanyResponse>> Archive(Guid companyId)
    {
        var company = await _db.Companies.FirstOrDefaultAsync(c => c.Id == companyId);
        if (company is null)
            return NotFound(string.Format(_localizer["CompanyNotFound"], companyId));

        if (company.IsArchived)
            return BadRequest(_localizer["CompanyAlreadyArchived"].Value);

        company.IsArchived = true;
        company.ArchivedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(ToResponse(company));
    }

    [HttpPost("{companyId:guid}/unarchive")]
    [RequireCompanyAccess(adminOnly: true)]
    [ProducesResponseType(typeof(CompanyResponse), StatusCodes.Status200OK)]
    public async Task<ActionResult<CompanyResponse>> Unarchive(Guid companyId)
    {
        var company = await _db.Companies.FirstOrDefaultAsync(c => c.Id == companyId);
        if (company is null)
            return NotFound(string.Format(_localizer["CompanyNotFound"], companyId));

        if (!company.IsArchived)
            return BadRequest(_localizer["CompanyNotArchived"].Value);

        company.IsArchived = false;
        company.ArchivedAt = null;
        await _db.SaveChangesAsync();


        return Ok(ToResponse(company));
    }

    // ---- Company bank accounts ----

    [HttpGet("{companyId:guid}/bank-accounts")]
    [RequireCompanyAccess(module: AccessModule.Settings)]
    [ProducesResponseType(typeof(List<CompanyBankAccountResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<CompanyBankAccountResponse>>> ListBankAccounts(Guid companyId)
    {
        var accounts = await _db.CompanyBankAccounts.AsNoTracking()
            .Where(b => b.CompanyId == companyId)
            .OrderBy(b => b.SortOrder)
            .ToListAsync();
        return Ok(accounts.Select(ToBankAccountResponse).ToList());
    }

    [HttpPost("{companyId:guid}/bank-accounts")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Settings)]
    [ProducesResponseType(typeof(CompanyBankAccountResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<CompanyBankAccountResponse>> CreateBankAccount(Guid companyId, CreateCompanyBankAccountRequest request)
    {
        var company = await _db.Companies.AsNoTracking().FirstOrDefaultAsync(c => c.Id == companyId);
        if (company is null)
            return NotFound(string.Format(_localizer["CompanyNotFound"], companyId));
        if (company.IsArchived)
            return BadRequest(_localizer["CompanyIsArchived"].Value);
        if (string.IsNullOrWhiteSpace(request.BankName))
            return BadRequest(_localizer["BankNameRequired"].Value);

        var maxSort = await _db.CompanyBankAccounts.Where(b => b.CompanyId == companyId).MaxAsync(b => (int?)b.SortOrder) ?? -1;

        if (request.IsDefault)
        {
            await _db.CompanyBankAccounts.Where(b => b.CompanyId == companyId && b.IsDefault)
                .ExecuteUpdateAsync(s => s.SetProperty(b => b.IsDefault, false));
        }

        var account = new CompanyBankAccount
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            BankName = request.BankName.Trim(),
            AccountHolder = request.AccountHolder?.Trim(),
            Iban = request.Iban?.Trim(),
            SwiftBic = request.SwiftBic?.Trim(),
            IsDefault = request.IsDefault,
            SortOrder = maxSort + 1
        };
        _db.CompanyBankAccounts.Add(account);
        await _db.SaveChangesAsync();

        return StatusCode(StatusCodes.Status201Created, ToBankAccountResponse(account));
    }

    [HttpPut("{companyId:guid}/bank-accounts/{bankAccountId:guid}")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Settings)]
    [ProducesResponseType(typeof(CompanyBankAccountResponse), StatusCodes.Status200OK)]
    public async Task<ActionResult<CompanyBankAccountResponse>> UpdateBankAccount(Guid companyId, Guid bankAccountId, UpdateCompanyBankAccountRequest request)
    {
        var account = await _db.CompanyBankAccounts.FirstOrDefaultAsync(b => b.Id == bankAccountId && b.CompanyId == companyId);
        if (account is null)
            return NotFound(string.Format(_localizer["BankAccountNotFound"], bankAccountId));

        var company = await _db.Companies.AsNoTracking().FirstOrDefaultAsync(c => c.Id == companyId);
        if (company is { IsArchived: true })
            return BadRequest(_localizer["CompanyIsArchived"].Value);

        if (request.BankName is not null)
        {
            if (string.IsNullOrWhiteSpace(request.BankName))
                return BadRequest(_localizer["BankNameRequired"].Value);
            account.BankName = request.BankName.Trim();
        }
        if (request.AccountHolder is not null) account.AccountHolder = request.AccountHolder == "" ? null : request.AccountHolder.Trim();
        if (request.Iban is not null) account.Iban = request.Iban == "" ? null : request.Iban.Trim();
        if (request.SwiftBic is not null) account.SwiftBic = request.SwiftBic == "" ? null : request.SwiftBic.Trim();

        if (request.IsDefault is true)
        {
            await _db.CompanyBankAccounts.Where(b => b.CompanyId == companyId && b.IsDefault && b.Id != bankAccountId)
                .ExecuteUpdateAsync(s => s.SetProperty(b => b.IsDefault, false));
            account.IsDefault = true;
        }
        else if (request.IsDefault is false)
        {
            account.IsDefault = false;
        }

        await _db.SaveChangesAsync();
        return Ok(ToBankAccountResponse(account));
    }

    [HttpDelete("{companyId:guid}/bank-accounts/{bankAccountId:guid}")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Settings)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<ActionResult> DeleteBankAccount(Guid companyId, Guid bankAccountId)
    {
        var account = await _db.CompanyBankAccounts.FirstOrDefaultAsync(b => b.Id == bankAccountId && b.CompanyId == companyId);
        if (account is null)
            return NotFound(string.Format(_localizer["BankAccountNotFound"], bankAccountId));

        _db.CompanyBankAccounts.Remove(account);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    // ---- Logo / Stamp upload ----

    [HttpPost("{companyId:guid}/logo")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Settings)]
    [ProducesResponseType(typeof(CompanyResponse), StatusCodes.Status200OK)]
    [Consumes("multipart/form-data")]
    public async Task<ActionResult<CompanyResponse>> UploadLogo(Guid companyId, IFormFile file)
    {
        return await UploadBrandingImage(companyId, file, "logo");
    }

    [HttpDelete("{companyId:guid}/logo")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Settings)]
    [ProducesResponseType(typeof(CompanyResponse), StatusCodes.Status200OK)]
    public async Task<ActionResult<CompanyResponse>> DeleteLogo(Guid companyId)
    {
        return await DeleteBrandingImage(companyId, "logo");
    }

    [HttpPost("{companyId:guid}/stamp")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Settings)]
    [ProducesResponseType(typeof(CompanyResponse), StatusCodes.Status200OK)]
    [Consumes("multipart/form-data")]
    public async Task<ActionResult<CompanyResponse>> UploadStamp(Guid companyId, IFormFile file)
    {
        return await UploadBrandingImage(companyId, file, "stamp");
    }

    [HttpDelete("{companyId:guid}/stamp")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Settings)]
    [ProducesResponseType(typeof(CompanyResponse), StatusCodes.Status200OK)]
    public async Task<ActionResult<CompanyResponse>> DeleteStamp(Guid companyId)
    {
        return await DeleteBrandingImage(companyId, "stamp");
    }

    private async Task<ActionResult<CompanyResponse>> UploadBrandingImage(Guid companyId, IFormFile file, string kind)
    {
        var company = await _db.Companies.FirstOrDefaultAsync(c => c.Id == companyId);
        if (company is null)
            return NotFound(string.Format(_localizer["CompanyNotFound"], companyId));
        if (company.IsArchived)
            return BadRequest(_localizer["CompanyIsArchived"].Value);

        if (file.Length == 0)
            return BadRequest(_localizer["FileRequired"].Value);
        if (file.Length > 2 * 1024 * 1024) // 2 MB limit
            return BadRequest(_localizer["FileTooLarge"].Value);

        var allowedTypes = new[] { "image/png", "image/jpeg", "image/svg+xml", "image/webp" };
        if (!allowedTypes.Contains(file.ContentType))
            return BadRequest(_localizer["InvalidImageType"].Value);

        var uploadsDir = Path.Combine("wwwroot", "uploads", "companies", companyId.ToString());
        Directory.CreateDirectory(uploadsDir);

        var ext = Path.GetExtension(file.FileName);
        var fileName = $"{kind}{ext}";
        var filePath = Path.Combine(uploadsDir, fileName);

        // Delete old file if exists (different extension)
        foreach (var old in Directory.GetFiles(uploadsDir, $"{kind}.*"))
            System.IO.File.Delete(old);

        await using var stream = new FileStream(filePath, FileMode.Create);
        await file.CopyToAsync(stream);

        var url = $"/uploads/companies/{companyId}/{fileName}";
        if (kind == "logo") company.LogoUrl = url;
        else company.StampUrl = url;

        await _db.SaveChangesAsync();
        return Ok(ToResponse(company));
    }

    private async Task<ActionResult<CompanyResponse>> DeleteBrandingImage(Guid companyId, string kind)
    {
        var company = await _db.Companies.FirstOrDefaultAsync(c => c.Id == companyId);
        if (company is null)
            return NotFound(string.Format(_localizer["CompanyNotFound"], companyId));

        if (kind == "logo") company.LogoUrl = null;
        else company.StampUrl = null;

        var uploadsDir = Path.Combine("wwwroot", "uploads", "companies", companyId.ToString());
        if (Directory.Exists(uploadsDir))
        {
            foreach (var old in Directory.GetFiles(uploadsDir, $"{kind}.*"))
                System.IO.File.Delete(old);
        }

        await _db.SaveChangesAsync();
        return Ok(ToResponse(company));
    }

    private static CompanyResponse ToResponse(Company c) =>
        new(c.Id, c.Name, c.FirmId, c.AccountingLockDate, c.TaxLockDate, c.EnabledProfiles, c.IsVatRegistered, c.AllowNumberOverride,
            c.SaleLockDate, c.PurchaseLockDate, c.HardLockDate,
            c.TradingName, c.BusinessNumber, c.FiscalNumber, c.VatNumber,
            c.LegalForm, c.BusinessActivity, c.Description,
            c.Country, c.Municipality, c.StreetAddress, c.PostalCode, c.AddressLine2,
            c.Email, c.Phone, c.Website,
            c.BankName, c.BankAccountHolder, c.Iban, c.SwiftBic,
            c.DocumentFooter, c.PaymentInstructions,
            c.LogoUrl, c.StampUrl,
            c.VatRegistrationDate, c.FunctionalCurrency,
            c.IsArchived, c.ArchivedAt);

    private static CompanyBankAccountResponse ToBankAccountResponse(CompanyBankAccount b) =>
        new(b.Id, b.BankName, b.AccountHolder, b.Iban, b.SwiftBic, b.IsDefault, b.SortOrder);
}
