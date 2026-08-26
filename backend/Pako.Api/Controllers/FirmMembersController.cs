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
[Route("api/firms/{firmId:guid}/members")]
[Authorize]
public class FirmMembersController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly UserManager<AppUser> _userManager;

    public FirmMembersController(PakoDbContext db, UserManager<AppUser> userManager)
    {
        _db = db;
        _userManager = userManager;
    }

    [HttpGet]
    [RequireFirmAccess]
    public async Task<ActionResult<List<MemberResponse>>> List(Guid firmId)
    {
        var memberships = await _db.Memberships.AsNoTracking()
            .Where(m => m.FirmId == firmId)
            .ToListAsync();

        var userIds = memberships.Select(m => m.UserId).Distinct().ToList();
        var emailsByUserId = await _db.Users.AsNoTracking()
            .Where(u => userIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, u => u.Email ?? string.Empty);

        return Ok(memberships
            .Select(m => new MemberResponse(m.Id, m.UserId, emailsByUserId.GetValueOrDefault(m.UserId, string.Empty), m.Role))
            .ToList());
    }

    [HttpPost]
    [RequireFirmAccess(adminOnly: true)]
    [ProducesResponseType(typeof(MemberResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<MemberResponse>> Create(Guid firmId, AddMemberRequest request)
    {
        if (request.Role != MembershipRole.FirmAdmin && request.Role != MembershipRole.FirmAccountant)
        {
            return BadRequest("Role must be FirmAdmin or FirmAccountant for a firm membership.");
        }

        var user = await _userManager.FindByEmailAsync(request.Email);
        if (user is null)
        {
            return NotFound($"No PAKO account exists for {request.Email}.");
        }

        var alreadyMember = await _db.Memberships.AsNoTracking()
            .AnyAsync(m => m.UserId == user.Id && m.FirmId == firmId);
        if (alreadyMember)
        {
            return BadRequest($"{request.Email} is already a member of this firm.");
        }

        var membership = Membership.ForFirm(user.Id, firmId, request.Role);
        _db.Memberships.Add(membership);
        await _db.SaveChangesAsync();

        return StatusCode(StatusCodes.Status201Created, new MemberResponse(membership.Id, user.Id, user.Email!, membership.Role));
    }
}
