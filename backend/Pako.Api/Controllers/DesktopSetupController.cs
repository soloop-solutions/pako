using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Auth;
using Pako.Api.Contracts;
using Pako.Api.Desktop;
using Pako.Domain.Desktop;
using Pako.Infrastructure;
using Pako.Infrastructure.Desktop;
using Pako.Infrastructure.Identity;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/desktop")]
[AllowAnonymous]
public class DesktopSetupController(
    PakoDbContext db,
    UserManager<AppUser> users,
    PlatformBootstrap bootstrap,
    RefreshTokenService refreshTokens,
    RecoveryThrottle throttle,
    TimeProvider clock,
    IStringLocalizer<ErrorMessages> localizer) : ControllerBase
{
    [HttpGet("setup", Name = "GetDesktopSetup")]
    public async Task<ActionResult<DesktopSetupStatusResponse>> Status(CancellationToken ct) =>
        Ok(new DesktopSetupStatusResponse(!await db.Users.AnyAsync(ct)));

    [HttpPost("setup", Name = "CompleteDesktopSetup")]
    public async Task<ActionResult<DesktopSetupResponse>> Setup(DesktopSetupRequest request, CancellationToken ct)
    {
        if (await db.Users.AnyAsync(ct)) return Conflict();

        var email = (request.Email ?? string.Empty).Trim();
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var created = await bootstrap.CreateAdministratorAsync(email, request.Password ?? string.Empty, request.FullName?.Trim() ?? string.Empty);
        if (!created.Succeeded)
            return BadRequest(string.Join(" ", created.Errors.Select(e => e.Description)));

        var user = await users.FindByEmailAsync(email);
        var code = RecoveryCode.Generate();
        db.Set<AdminRecoveryRecord>().Add(new AdminRecoveryRecord
        {
            Id = Guid.NewGuid(),
            UserId = user!.Id.ToString(),
            CodeHash = RecoveryCode.Hash(code),
            CreatedAt = clock.GetUtcNow(),
        });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return Ok(new DesktopSetupResponse(code));
    }

    [HttpPost("recover", Name = "RecoverDesktopAdmin")]
    public async Task<IActionResult> Recover(RecoverAdminRequest request, CancellationToken ct)
    {
        var email = (request.Email ?? string.Empty).Trim();
        if (throttle.IsLocked(email)) return BadRequest(localizer["RecoveryCodeInvalid"].Value);

        var user = await users.FindByEmailAsync(email);
        AdminRecoveryRecord? match = null;
        if (user is not null)
        {
            var userId = user.Id.ToString();
            var records = await db.Set<AdminRecoveryRecord>().Where(r => r.UserId == userId && r.UsedAt == null).ToListAsync(ct);
            match = records.FirstOrDefault(r => RecoveryCode.Verify(request.RecoveryCode ?? string.Empty, r.CodeHash));
        }

        if (user is null || match is null)
        {
            throttle.RecordFailure(email);
            return BadRequest(localizer["RecoveryCodeInvalid"].Value);
        }

        var token = await users.GeneratePasswordResetTokenAsync(user);
        var reset = await users.ResetPasswordAsync(user, token, request.NewPassword ?? string.Empty);
        if (!reset.Succeeded)
            return BadRequest(string.Join(" ", reset.Errors.Select(e => e.Description)));

        match.UsedAt = clock.GetUtcNow();
        await db.SaveChangesAsync(ct);
        await refreshTokens.RevokeAllForUserAsync(user.Id);
        await users.SetLockoutEndDateAsync(user, null);
        await users.ResetAccessFailedCountAsync(user);
        throttle.Reset(email);
        return NoContent();
    }
}
