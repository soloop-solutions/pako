using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Domain.Hr;
using Pako.Domain.Payroll;
using Pako.Infrastructure;
using Pako.Localization.Xk;

namespace Pako.Api.Controllers;

// Employee master data, partner assignments and dated contracts. Salary data is HR-module data:
// staff need HR access to read any of it. The fields that decide a login's access — UserId,
// DepartmentId and the partner assignments — are security changes only classic write roles may
// make, never staff (a staff user with HR Write could otherwise move themselves into a more
// privileged department).
[ApiController]
[Route("api/companies/{companyId:guid}/employees")]
[Authorize]
public class EmployeesController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly CompanyAccessContext _access;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public EmployeesController(PakoDbContext db, CompanyAccessContext access, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _access = access;
        _localizer = localizer;
    }

    // B7 paging. ?search= matches name, personal number, email or job title; sort=name|hireDate|salary.
    [HttpGet(Name = "ListEmployees")]
    [RequireCompanyAccess(module: AccessModule.Hr)]
    public async Task<ActionResult<PaginatedResponse<EmployeeDetailResponse>>> List(
        Guid companyId,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        [FromQuery] string? search = null,
        [FromQuery] string? sort = null,
        [FromQuery] Guid? departmentId = null,
        [FromQuery] bool includeInactive = false)
    {
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 200);

        var query = _db.Employees.AsNoTracking().Where(e => e.CompanyId == companyId);
        if (!includeInactive) query = query.Where(e => e.IsActive);
        if (departmentId is { } dept) query = query.Where(e => e.DepartmentId == dept);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = $"%{search.Trim()}%";
            query = query.Where(e =>
                EF.Functions.ILike(e.Name, pattern) ||
                (e.PersonalNumber != null && EF.Functions.ILike(e.PersonalNumber, pattern)) ||
                (e.Email != null && EF.Functions.ILike(e.Email, pattern)) ||
                (e.JobTitle != null && EF.Functions.ILike(e.JobTitle, pattern)));
        }

        query = sort switch
        {
            "hireDate" => query.OrderBy(e => e.HireDate).ThenBy(e => e.Name),
            "-hireDate" => query.OrderByDescending(e => e.HireDate).ThenBy(e => e.Name),
            "salary" => query.OrderBy(e => e.MonthlyGrossSalary).ThenBy(e => e.Name),
            "-salary" => query.OrderByDescending(e => e.MonthlyGrossSalary).ThenBy(e => e.Name),
            "-name" => query.OrderByDescending(e => e.Name),
            _ => query.OrderBy(e => e.Name)
        };

        var total = await query.CountAsync();
        var employees = await query.Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();

        return Ok(new PaginatedResponse<EmployeeDetailResponse>(await ToResponsesAsync(companyId, employees), total, page, pageSize));
    }

    [HttpGet("{id:guid}", Name = "GetEmployee")]
    [RequireCompanyAccess(module: AccessModule.Hr)]
    public async Task<ActionResult<EmployeeDetailResponse>> Get(Guid companyId, Guid id)
    {
        var employee = await _db.Employees.AsNoTracking().FirstOrDefaultAsync(e => e.Id == id && e.CompanyId == companyId);
        if (employee is null) return NotFound();

        return Ok((await ToResponsesAsync(companyId, new List<Employee> { employee })).Single());
    }

    [HttpPost(Name = "CreateEmployee")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Hr)]
    [ProducesResponseType(typeof(EmployeeDetailResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<EmployeeDetailResponse>> Create(Guid companyId, SaveEmployeeRequest request)
    {
        if (_access.IsStaffAccess && (request.UserId is not null || request.DepartmentId is not null)) return Forbid();

        var employee = new Employee { Id = Guid.NewGuid(), CompanyId = companyId };
        var error = await ApplyAsync(companyId, employee, request);
        if (error is not null) return error;

        _db.Employees.Add(employee);
        await _db.SaveChangesAsync();

        return StatusCode(StatusCodes.Status201Created, (await ToResponsesAsync(companyId, new List<Employee> { employee })).Single());
    }

    [HttpPut("{id:guid}", Name = "UpdateEmployee")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Hr)]
    public async Task<ActionResult<EmployeeDetailResponse>> Update(Guid companyId, Guid id, SaveEmployeeRequest request)
    {
        var employee = await _db.Employees.FirstOrDefaultAsync(e => e.Id == id && e.CompanyId == companyId);
        if (employee is null) return NotFound();

        if (_access.IsStaffAccess && (request.UserId != employee.UserId || request.DepartmentId != employee.DepartmentId)) return Forbid();

        var error = await ApplyAsync(companyId, employee, request);
        if (error is not null) return error;

        await _db.SaveChangesAsync();
        return Ok((await ToResponsesAsync(companyId, new List<Employee> { employee })).Single());
    }

    // ---- Partner assignments ----

    [HttpGet("{id:guid}/partners", Name = "ListEmployeePartners")]
    [RequireCompanyAccess(module: AccessModule.Hr)]
    public async Task<ActionResult<List<EmployeePartnerResponse>>> ListPartners(Guid companyId, Guid id)
    {
        if (!await _db.Employees.AnyAsync(e => e.Id == id && e.CompanyId == companyId)) return NotFound();

        var partners = await (
            from a in _db.EmployeePartnerAssignments.AsNoTracking()
            join p in _db.Partners.AsNoTracking() on a.PartnerId equals p.Id
            where a.EmployeeId == id && a.CompanyId == companyId
            orderby p.Name
            select new EmployeePartnerResponse(p.Id, p.Name, p.IsCustomer, p.IsVendor)).ToListAsync();

        return Ok(partners);
    }

    // Replaces the whole set — the web edits it as one multi-select.
    [HttpPut("{id:guid}/partners", Name = "SetEmployeePartners")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Hr)]
    public async Task<ActionResult<List<EmployeePartnerResponse>>> SetPartners(Guid companyId, Guid id, SetEmployeePartnersRequest request)
    {
        if (_access.IsStaffAccess) return Forbid();
        if (!await _db.Employees.AnyAsync(e => e.Id == id && e.CompanyId == companyId)) return NotFound();

        var requested = request.PartnerIds.Distinct().ToList();
        var found = await _db.Partners.Where(p => p.CompanyId == companyId && requested.Contains(p.Id)).CountAsync();
        if (found != requested.Count) return BadRequest(_localizer["AssignedPartnerNotFound"].Value);

        var existing = await _db.EmployeePartnerAssignments.Where(a => a.EmployeeId == id).ToListAsync();
        _db.EmployeePartnerAssignments.RemoveRange(existing.Where(a => !requested.Contains(a.PartnerId)));
        var existingIds = existing.Select(a => a.PartnerId).ToHashSet();
        _db.EmployeePartnerAssignments.AddRange(requested.Where(p => !existingIds.Contains(p)).Select(p => new EmployeePartnerAssignment
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            EmployeeId = id,
            PartnerId = p
        }));
        await _db.SaveChangesAsync();

        return await ListPartners(companyId, id);
    }

    // ---- Contracts (salary history) ----

    [HttpGet("{id:guid}/contracts", Name = "ListEmployeeContracts")]
    [RequireCompanyAccess(module: AccessModule.Hr)]
    public async Task<ActionResult<List<EmployeeContractResponse>>> ListContracts(Guid companyId, Guid id)
    {
        if (!await _db.Employees.AnyAsync(e => e.Id == id && e.CompanyId == companyId)) return NotFound();

        var contracts = await _db.EmployeeContracts.AsNoTracking()
            .Where(c => c.EmployeeId == id && c.CompanyId == companyId)
            .OrderByDescending(c => c.StartDate)
            .ToListAsync();

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        return Ok(contracts.Select(c => ToContractResponse(c, today)).ToList());
    }

    [HttpPost("{id:guid}/contracts", Name = "CreateEmployeeContract")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Hr)]
    [ProducesResponseType(typeof(EmployeeContractResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<EmployeeContractResponse>> CreateContract(Guid companyId, Guid id, SaveEmployeeContractRequest request)
    {
        if (!await _db.Employees.AnyAsync(e => e.Id == id && e.CompanyId == companyId)) return NotFound();

        var contract = new EmployeeContract { Id = Guid.NewGuid(), CompanyId = companyId, EmployeeId = id };
        var error = await ApplyContractAsync(contract, request);
        if (error is not null) return error;

        _db.EmployeeContracts.Add(contract);
        await _db.SaveChangesAsync();

        return StatusCode(StatusCodes.Status201Created, ToContractResponse(contract, DateOnly.FromDateTime(DateTime.UtcNow)));
    }

    [HttpPut("{id:guid}/contracts/{contractId:guid}", Name = "UpdateEmployeeContract")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Hr)]
    public async Task<ActionResult<EmployeeContractResponse>> UpdateContract(Guid companyId, Guid id, Guid contractId, SaveEmployeeContractRequest request)
    {
        var contract = await _db.EmployeeContracts.FirstOrDefaultAsync(c => c.Id == contractId && c.EmployeeId == id && c.CompanyId == companyId);
        if (contract is null) return NotFound();

        var error = await ApplyContractAsync(contract, request);
        if (error is not null) return error;

        await _db.SaveChangesAsync();
        return Ok(ToContractResponse(contract, DateOnly.FromDateTime(DateTime.UtcNow)));
    }

    [HttpDelete("{id:guid}/contracts/{contractId:guid}", Name = "DeleteEmployeeContract")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Hr)]
    public async Task<IActionResult> DeleteContract(Guid companyId, Guid id, Guid contractId)
    {
        var contract = await _db.EmployeeContracts.FirstOrDefaultAsync(c => c.Id == contractId && c.EmployeeId == id && c.CompanyId == companyId);
        if (contract is null) return NotFound();

        _db.EmployeeContracts.Remove(contract);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    private async Task<ActionResult?> ApplyContractAsync(EmployeeContract contract, SaveEmployeeContractRequest request)
    {
        if (request.MonthlyGrossSalary <= 0) return BadRequest(_localizer["SalaryMustBePositive"].Value);
        if (request.EndDate is { } end && end < request.StartDate) return BadRequest(_localizer["ContractEndBeforeStart"].Value);
        if (request.WeeklyHours is < 1m or > 60m) return BadRequest(_localizer["WeeklyHoursInvalid"].Value);

        var others = await _db.EmployeeContracts.AsNoTracking()
            .Where(c => c.EmployeeId == contract.EmployeeId && c.Id != contract.Id)
            .ToListAsync();
        if (others.Any(c => c.Overlaps(request.StartDate, request.EndDate))) return BadRequest(_localizer["ContractOverlaps"].Value);

        contract.StartDate = request.StartDate;
        contract.EndDate = request.EndDate;
        contract.MonthlyGrossSalary = request.MonthlyGrossSalary;
        contract.EmploymentType = request.EmploymentType;
        contract.WeeklyHours = request.WeeklyHours;
        contract.JobTitle = string.IsNullOrWhiteSpace(request.JobTitle) ? null : request.JobTitle.Trim();
        contract.Notes = string.IsNullOrWhiteSpace(request.Notes) ? null : request.Notes.Trim();
        return null;
    }

    private static EmployeeContractResponse ToContractResponse(EmployeeContract c, DateOnly today) => new(
        c.Id, c.EmployeeId, c.StartDate, c.EndDate, c.MonthlyGrossSalary, c.EmploymentType, c.WeeklyHours, c.JobTitle, c.Notes, c.CoversDate(today));

    // ---- Shared ----

    private async Task<ActionResult?> ApplyAsync(Guid companyId, Employee employee, SaveEmployeeRequest request)
    {
        var name = Employee.DisplayName(request.FirstName, request.LastName, request.Name);
        if (name.Length == 0) return BadRequest(_localizer["EmployeeNameRequired"].Value);
        if (request.MonthlyGrossSalary <= 0) return BadRequest(_localizer["SalaryMustBePositive"].Value);
        if (request.MonthlyGrossSalary != Math.Round(request.MonthlyGrossSalary, 2))
            return BadRequest(_localizer["SalaryExcessivePrecision"].Value);
        if (request.MonthlyGrossSalary > 1_000_000m)
            return BadRequest(_localizer["SalaryExceedsMaximum"].Value);
        if (request.HireDate is { } hire && request.TerminationDate is { } term && term < hire)
        {
            return BadRequest(_localizer["TerminationBeforeHire"].Value);
        }

        var personalNumber = string.IsNullOrWhiteSpace(request.PersonalNumber) ? null : request.PersonalNumber.Trim();
        if (personalNumber is not null)
        {
            if (!EmployeeValidation.IsValidPersonalNumber(personalNumber)) return BadRequest(_localizer["PersonalNumberInvalid"].Value);
            if (await _db.Employees.AnyAsync(e => e.CompanyId == companyId && e.PersonalNumber == personalNumber && e.Id != employee.Id))
            {
                return BadRequest(string.Format(_localizer["PersonalNumberTaken"], personalNumber));
            }
        }

        string? iban = null;
        if (!string.IsNullOrWhiteSpace(request.Iban))
        {
            iban = EmployeeValidation.NormalizeIban(request.Iban);
            if (!EmployeeValidation.IsValidIban(iban)) return BadRequest(_localizer["IbanInvalid"].Value);
        }

        if (request.DepartmentId is { } departmentId &&
            !await _db.Departments.AnyAsync(d => d.Id == departmentId && d.CompanyId == companyId))
        {
            return BadRequest(_localizer["DepartmentNotFound"].Value);
        }

        if (request.ManagerId is { } managerId)
        {
            if (managerId == employee.Id) return BadRequest(_localizer["ManagerCannotBeSelf"].Value);
            if (!await _db.Employees.AnyAsync(e => e.Id == managerId && e.CompanyId == companyId))
            {
                return BadRequest(_localizer["EmployeeNotFound"].Value);
            }
        }

        if (request.UserId is { } userId)
        {
            if (!await _db.Users.AnyAsync(u => u.Id == userId)) return BadRequest(_localizer["UserNotCompanyMember"].Value);
            if (await _db.Employees.AnyAsync(e => e.CompanyId == companyId && e.UserId == userId && e.Id != employee.Id))
            {
                return BadRequest(_localizer["EmployeeUserTaken"].Value);
            }
        }

        employee.Name = name;
        employee.FirstName = Clean(request.FirstName);
        employee.LastName = Clean(request.LastName);
        employee.PersonalNumber = personalNumber;
        employee.Email = Clean(request.Email);
        employee.Phone = Clean(request.Phone);
        employee.Address = Clean(request.Address);
        employee.BirthDate = request.BirthDate;
        employee.HireDate = request.HireDate;
        employee.TerminationDate = request.TerminationDate;
        employee.JobTitle = Clean(request.JobTitle);
        employee.DepartmentId = request.DepartmentId;
        employee.ManagerId = request.ManagerId;
        employee.UserId = request.UserId;
        employee.Iban = iban;
        employee.BankName = Clean(request.BankName);
        employee.MonthlyGrossSalary = request.MonthlyGrossSalary;
        employee.IsPrimaryEmployer = request.IsPrimaryEmployer;
        employee.PensionExempt = request.PensionExempt;
        employee.IsActive = request.IsActive;
        return null;
    }

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private async Task<List<EmployeeDetailResponse>> ToResponsesAsync(Guid companyId, List<Employee> employees)
    {
        var ids = employees.Select(e => e.Id).ToList();
        var today = DateOnly.FromDateTime(DateTime.UtcNow);

        var departmentNames = await _db.Departments.AsNoTracking()
            .Where(d => d.CompanyId == companyId)
            .ToDictionaryAsync(d => d.Id, d => d.Name);

        var managerIds = employees.Where(e => e.ManagerId != null).Select(e => e.ManagerId!.Value).ToList();
        var managerNames = await _db.Employees.AsNoTracking()
            .Where(e => managerIds.Contains(e.Id))
            .ToDictionaryAsync(e => e.Id, e => e.Name);

        var userIds = employees.Where(e => e.UserId != null).Select(e => e.UserId!.Value).ToList();
        var userEmails = await _db.Users.AsNoTracking()
            .Where(u => userIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, u => u.Email);

        var currentContracts = (await _db.EmployeeContracts.AsNoTracking()
                .Where(c => ids.Contains(c.EmployeeId) && c.StartDate <= today && (c.EndDate == null || c.EndDate >= today))
                .ToListAsync())
            .GroupBy(c => c.EmployeeId)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(c => c.StartDate).First());

        var partnerCounts = await _db.EmployeePartnerAssignments.AsNoTracking()
            .Where(a => ids.Contains(a.EmployeeId))
            .GroupBy(a => a.EmployeeId)
            .Select(g => new { g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Key, x => x.Count);

        var minimumWage = KosovoPayrollRules.MinimumWageOn(today);

        return employees.Select(e =>
        {
            var currentSalary = currentContracts.GetValueOrDefault(e.Id)?.MonthlyGrossSalary ?? e.MonthlyGrossSalary;
            var isFullTime = currentContracts.GetValueOrDefault(e.Id) is not { EmploymentType: EmploymentType.PartTime };
            var warnings = new List<string>();
            if (e.IsActive && isFullTime && minimumWage is { } min && currentSalary < min) warnings.Add("BelowMinimumWage");
            if (e.PersonalNumber is null) warnings.Add("MissingPersonalNumber");
            if (e.Iban is null) warnings.Add("MissingIban");

            return new EmployeeDetailResponse(
                e.Id,
                e.Name,
                e.FirstName,
                e.LastName,
                e.PersonalNumber,
                e.Email,
                e.Phone,
                e.Address,
                e.BirthDate,
                e.HireDate,
                e.TerminationDate,
                e.JobTitle,
                e.DepartmentId,
                e.DepartmentId is { } d ? departmentNames.GetValueOrDefault(d) : null,
                e.ManagerId,
                e.ManagerId is { } m ? managerNames.GetValueOrDefault(m) : null,
                e.UserId,
                e.UserId is { } u ? userEmails.GetValueOrDefault(u) : null,
                e.Iban,
                e.BankName,
                e.MonthlyGrossSalary,
                currentSalary,
                e.IsPrimaryEmployer,
                e.PensionExempt,
                e.IsActive,
                partnerCounts.GetValueOrDefault(e.Id),
                warnings);
        }).ToList();
    }
}
