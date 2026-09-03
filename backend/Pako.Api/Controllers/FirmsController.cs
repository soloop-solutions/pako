using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Contracts;
using Pako.Domain.Companies;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/firms")]
[Authorize]
public class FirmsController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public FirmsController(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _localizer = localizer;
    }

    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpPost]
    [ProducesResponseType(typeof(FirmResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<FirmResponse>> Create(CreateFirmRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return BadRequest(_localizer["FirmNameRequired"].Value);
        }

        if (request.Name.Length > 256)
        {
            return BadRequest(_localizer["FirmNameTooLong"].Value);
        }

        var firm = new Firm { Id = Guid.NewGuid(), Name = request.Name };
        _db.Firms.Add(firm);
        _db.Memberships.Add(Membership.ForFirm(CurrentUserId, firm.Id, MembershipRole.FirmAdmin));

        await _db.SaveChangesAsync();

        return StatusCode(StatusCodes.Status201Created, ToResponse(firm));
    }

    [HttpGet]
    public async Task<ActionResult<List<FirmResponse>>> List()
    {
        var userId = CurrentUserId;

        var firmIds = await _db.Memberships.AsNoTracking()
            .Where(m => m.UserId == userId && m.FirmId != null)
            .Select(m => m.FirmId!.Value)
            .ToListAsync();

        var firms = await _db.Firms.AsNoTracking()
            .Where(f => firmIds.Contains(f.Id))
            .ToListAsync();

        return Ok(firms.Select(ToResponse).ToList());
    }

    private static FirmResponse ToResponse(Firm f) => new(f.Id, f.Name);
}
