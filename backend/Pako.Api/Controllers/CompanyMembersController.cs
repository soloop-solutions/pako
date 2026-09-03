using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Domain.Companies;
using Pako.Infrastructure;
using Pako.Infrastructure.Identity;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId:guid}/members")]
[Authorize]
public class CompanyMembersController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly UserManager<AppUser> _userManager;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public CompanyMembersController(PakoDbContext db, UserManager<AppUser> userManager, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _userManager = userManager;
        _localizer = localizer;
    }

    [HttpGet]
    [RequireCompanyAccess]
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
        if (request.Role != MembershipRole.ClientAdmin && request.Role != MembershipRole.ClientViewer)
        {
            return BadRequest(_localizer["RoleMustBeCompanyRole"].Value);
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

        var membership = Membership.ForCompany(user.Id, companyId, request.Role);
        _db.Memberships.Add(membership);
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
