using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
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

    public CompanyMembersController(PakoDbContext db, UserManager<AppUser> userManager)
    {
        _db = db;
        _userManager = userManager;
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
            return BadRequest("Role must be ClientAdmin or ClientViewer for a company membership.");
        }

        var user = await _userManager.FindByEmailAsync(request.Email);
        if (user is null)
        {
            return NotFound($"No PAKO account exists for {request.Email}.");
        }

        // Deliberately scoped to a direct CompanyId match only, not the firm-cascade too: adding a
        // direct membership for a user who already has firm-cascaded access is allowed by design
        // — it's how you explicitly restrict/override a specific member for this one company (e.g.
        // give a firm-cascaded FirmAccountant a narrower direct ClientViewer here). CompanyAccessFilter
        // then resolves the two as a union (most-permissive-wins), so this never silently locks
        // someone out — see its own comment for that policy.
        var alreadyMember = await _db.Memberships.AsNoTracking()
            .AnyAsync(m => m.UserId == user.Id && m.CompanyId == companyId);
        if (alreadyMember)
        {
            return BadRequest($"{request.Email} is already a member of this company.");
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
