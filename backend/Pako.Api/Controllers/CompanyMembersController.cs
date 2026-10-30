using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services.Notifications;
using Pako.Domain.Companies;
using Pako.Domain.Notifications;
using Pako.Infrastructure;
using Pako.Infrastructure.Identity;
using Pako.Domain.Hr;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId:guid}/members")]
[Authorize]
public class CompanyMembersController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly UserManager<AppUser> _userManager;
    private readonly NotificationOutbox _outbox;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public CompanyMembersController(
        PakoDbContext db, UserManager<AppUser> userManager, NotificationOutbox outbox, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _userManager = userManager;
        _outbox = outbox;
        _localizer = localizer;
    }

    [HttpGet]
    [RequireCompanyAccess(module: AccessModule.Users)]
    public async Task<ActionResult<List<MemberResponse>>> List(Guid companyId)
    {
        var company = await _db.Companies.AsNoTracking().FirstAsync(c => c.Id == companyId);

        var memberships = await _db.Memberships.AsNoTracking()
            .Where(m => m.CompanyId == companyId || (company.FirmId != null && m.FirmId == company.FirmId))
            .ToListAsync();

        return Ok(await ToResponsesAsync(memberships));
    }

    [HttpPost]
    [RequireCompanyAccess(writeAccess: true, adminOnly: true)]
    [ProducesResponseType(typeof(MemberResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<MemberResponse>> Create(Guid companyId, AddMemberRequest request)
    {
        if (request.Role != MembershipRole.ClientAdmin && request.Role != MembershipRole.ClientViewer &&
            request.Role != MembershipRole.ClientStaff)
        {
            return BadRequest(_localizer["RoleMustBeCompanyRole"].Value);
        }

        Pako.Domain.Payroll.Employee? employee = null;
        if (request.Role == MembershipRole.ClientStaff)
        {
            if (request.EmployeeId is not { } employeeId)
            {
                return BadRequest(_localizer["StaffNeedsEmployee"].Value);
            }

            employee = await _db.Employees.FirstOrDefaultAsync(e => e.Id == employeeId && e.CompanyId == companyId);
            if (employee is null)
            {
                return BadRequest(_localizer["EmployeeNotFound"].Value);
            }
        }

        var user = await _userManager.FindByEmailAsync(request.Email);
        if (user is null)
        {
            return NotFound(string.Format(_localizer["NoAccountForEmail"], request.Email));
        }

        var alreadyMember = await _db.Memberships.AsNoTracking()
            .AnyAsync(m => m.UserId == user.Id && m.CompanyId == companyId);
        if (alreadyMember)
        {
            return BadRequest(string.Format(_localizer["AlreadyCompanyMember"], request.Email));
        }

        if (employee is not null)
        {
            if (employee.UserId is { } linked && linked != user.Id ||
                await _db.Employees.AnyAsync(e => e.CompanyId == companyId && e.UserId == user.Id && e.Id != employee.Id))
            {
                return BadRequest(_localizer["EmployeeUserTaken"].Value);
            }

            employee.UserId = user.Id;
        }

        var membership = Membership.ForCompany(user.Id, companyId, request.Role);
        if (request.Role == MembershipRole.ClientStaff)
        {
            // docs/USER_ACCESS_PLAN.md: staff added here start on the built-in Employee role; the
            // administration dashboard gives them more.
            membership.CompanyRoleId = await _db.CompanyRoles
                .Where(r => r.CompanyId == companyId && r.BuiltInKey == "employee")
                .Select(r => (Guid?)r.Id)
                .FirstOrDefaultAsync();
        }

        _db.Memberships.Add(membership);

        var companyName = await _db.Companies.AsNoTracking().Where(c => c.Id == companyId).Select(c => c.Name).FirstAsync();
        await _outbox.EnqueueAsync(companyId, NotificationTemplates.StaffInvitation,
            new[] { new NotificationRecipient(user.Email!, employee?.PreferredLanguage ?? NotificationOutbox.DefaultCulture) },
            new Dictionary<string, string> { ["company"] = companyName });
        await _db.SaveChangesAsync();

        return StatusCode(StatusCodes.Status201Created, new MemberResponse(membership.Id, user.Id, user.Email!, membership.Role));
    }

    private async Task<List<MemberResponse>> ToResponsesAsync(List<Membership> memberships)
    {
        var userIds = memberships.Select(m => m.UserId).Distinct().ToList();
        var emailsByUserId = await _db.Users.AsNoTracking()
            .Where(u => userIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, u => u.Email ?? string.Empty);

        return memberships
            .Select(m => new MemberResponse(m.Id, m.UserId, emailsByUserId.GetValueOrDefault(m.UserId, string.Empty), m.Role))
            .ToList();
    }
}
