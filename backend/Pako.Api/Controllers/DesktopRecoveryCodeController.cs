using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Contracts;
using Pako.Api.Desktop;
using Pako.Infrastructure;
using Pako.Infrastructure.Desktop;
using Pako.Infrastructure.Identity;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/desktop/recovery-code")]
[Authorize]
public class DesktopRecoveryCodeController(
    PakoDbContext db,
    UserManager<AppUser> users,
    RecoveryThrottle throttle,
    TimeProvider clock,
    IStringLocalizer<ErrorMessages> localizer) : ControllerBase
{
    [HttpPost("regenerate", Name = "RegenerateDesktopRecoveryCode")]
    public async Task<ActionResult<RecoverAdminResponse>> Regenerate(RegenerateRecoveryCodeRequest request, CancellationToken ct)
    {
        var user = await users.FindByIdAsync(User.FindFirstValue(ClaimTypes.NameIdentifier) ?? string.Empty);
        if (user is null) return Unauthorized();
        if (!user.IsPlatformAdmin || user.IsDisabled) return Forbid();

        var email = user.Email ?? string.Empty;
        if (throttle.IsLocked(email)) return BadRequest(localizer["RecoveryCodeRegenerateInvalid"].Value);
        if (!await users.CheckPasswordAsync(user, request.CurrentPassword ?? string.Empty))
        {
            throttle.RecordFailure(email);
            return BadRequest(localizer["RecoveryCodeRegenerateInvalid"].Value);
        }

        var userId = user.Id.ToString();
        var unused = await db.Set<AdminRecoveryRecord>().Where(r => r.UserId == userId && r.UsedAt == null).ToListAsync(ct);
        var code = RecoveryCodeIssuer.Replace(db, user.Id, unused, clock.GetUtcNow());
        await db.SaveChangesAsync(ct);
        throttle.Reset(email);
        return Ok(new RecoverAdminResponse(code));
    }
}
