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
[Route("api/firms/{firmId:guid}/members")]
[Authorize]
public class FirmMembersController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly UserManager<AppUser> _userManager;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public FirmMembersController(PakoDbContext db, UserManager<AppUser> userManager, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _userManager = userManager;
        _localizer = localizer;
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
            return BadRequest(_localizer["RoleMustBeFirmRole"].Value);
        }

        var user = await _userManager.FindByEmailAsync(request.Email);
        if (user is null)
        {
            return NotFound(string.Format(_localizer["NoAccountForEmail"], request.Email));
        }

        var alreadyMember = await _db.Memberships.AsNoTracking()
            .AnyAsync(m => m.UserId == user.Id && m.FirmId == firmId);
        if (alreadyMember)
        {
            return BadRequest(string.Format(_localizer["AlreadyFirmMember"], request.Email));
        }

        var membership = Membership.ForFirm(user.Id, firmId, request.Role);
        _db.Memberships.Add(membership);
        await _db.SaveChangesAsync();

        return StatusCode(StatusCodes.Status201Created, new MemberResponse(membership.Id, user.Id, user.Email!, membership.Role));
    }
}
