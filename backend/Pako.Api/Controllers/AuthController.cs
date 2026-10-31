using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Localization;
using Microsoft.Extensions.Options;
using Pako.Api.Auth;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Infrastructure.Identity;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController : ControllerBase
{
    private readonly UserManager<AppUser> _userManager;
    private readonly IJwtTokenService _tokenService;
    private readonly IStringLocalizer<ErrorMessages> _localizer;
    private readonly ActionTokenService _actionTokenService;
    private readonly PlatformOptions _platform;

    // platform is optional only so tests can construct the controller directly; the app always
    // supplies it. Without it, self-registration behaves as before (allowed).
    public AuthController(UserManager<AppUser> userManager, IJwtTokenService tokenService,
        IStringLocalizer<ErrorMessages> localizer, ActionTokenService actionTokenService,
        IOptions<PlatformOptions>? platform = null)
    {
        _userManager = userManager;
        _tokenService = tokenService;
        _localizer = localizer;
        _actionTokenService = actionTokenService;
        _platform = platform?.Value ?? new PlatformOptions { AllowSelfRegistration = true };
    }

    [HttpPost("register")]
    [EnableRateLimiting(AuthRateLimit.Policy)]
    public async Task<ActionResult<AuthResponse>> Register(RegisterRequest request)
    {
        // docs/PLATFORM_ADMIN.md: accounts are requested and approved, not self-registered —
        // except in local development, where the e2e and demo-seed scripts need throwaway users.
        if (!_platform.AllowSelfRegistration)
        {
            return StatusCode(StatusCodes.Status403Forbidden, _localizer["SelfRegistrationDisabled"].Value);
        }

        var user = new AppUser { UserName = request.Email, Email = request.Email, CompanyLimit = null };
        var result = await _userManager.CreateAsync(user, request.Password);
        if (!result.Succeeded)
        {
            var isDuplicateEmail = result.Errors.Any(e =>
                e.Code is "DuplicateUserName" or "DuplicateEmail");
            if (isDuplicateEmail)
            {
                return BadRequest(_localizer["RegistrationFailed"].Value);
            }

            return BadRequest(string.Join(" ", result.Errors.Select(e => e.Description)));
        }

        var token = _tokenService.GenerateToken(user);
        return Ok(new AuthResponse(token, user.Id, user.Email!));
    }

    [HttpPost("login")]
    [EnableRateLimiting(AuthRateLimit.Policy)]
    public async Task<ActionResult<AuthResponse>> Login(LoginRequest request)
    {
        var user = await _userManager.FindByEmailAsync(request.Email);
        if (user is null) return Unauthorized();

        // docs/USER_ACCESS_PLAN.md §5: 5 wrong passwords lock the account for 15 minutes.
        if (await _userManager.IsLockedOutAsync(user))
        {
            // Only someone who knows the password learns that the account is locked; a wrong guess
            // looks like any other wrong guess, so locking can't be used to find out who has an account.
            return await _userManager.CheckPasswordAsync(user, request.Password)
                ? StatusCode(StatusCodes.Status423Locked, _localizer["AccountLocked"].Value)
                : Unauthorized();
        }

        if (!await _userManager.CheckPasswordAsync(user, request.Password))
        {
            await _userManager.AccessFailedAsync(user);
            return Unauthorized();
        }

        if (user.IsDisabled)
        {
            return StatusCode(StatusCodes.Status403Forbidden, _localizer["AccountDisabled"].Value);
        }

        await _userManager.ResetAccessFailedCountAsync(user);
        user.LastLoginAt = DateTime.UtcNow;
        if (_platform.IsAdminEmail(user.Email) && !user.IsPlatformAdmin)
        {
            user.IsPlatformAdmin = true;
            user.CompanyLimit = null;
        }
        await _userManager.UpdateAsync(user);

        var token = _tokenService.GenerateToken(user);
        return Ok(new AuthResponse(token, user.Id, user.Email!));
    }

    // ---- Invitations (docs/USER_ACCESS_PLAN.md) ----

    // What the accept page shows before the person sets a password. Never reveals more than the
    // invitation itself already says.
    [HttpGet("invitations/{token}", Name = "GetInvitation")]
    [EnableRateLimiting(AuthRateLimit.Policy)]
    public async Task<ActionResult<InvitationInfoResponse>> Invitation(string token, [FromServices] UserAdminService admin,
        [FromServices] Pako.Infrastructure.PakoDbContext db)
    {
        var invitation = await admin.OpenInvitationAsync(token);
        if (invitation is null) return NotFound(_localizer["InvitationInvalid"].Value);
        var company = await db.Companies.FindAsync(invitation.CompanyId);
        var exists = await _userManager.FindByEmailAsync(invitation.Email) is not null;
        return Ok(new InvitationInfoResponse(company?.Name ?? string.Empty, invitation.Email, invitation.FullName, exists, true));
    }

    [HttpPost("invitations/accept", Name = "AcceptInvitation")]
    [EnableRateLimiting(AuthRateLimit.Policy)]
    public async Task<ActionResult<AuthResponse>> AcceptInvitation(AcceptInvitationRequest request, [FromServices] UserAdminService admin)
    {
        var result = await admin.AcceptAsync(request);
        if (result.Value is not { } user) return BadRequest(result.Error);

        user.LastLoginAt = DateTime.UtcNow;
        await _userManager.UpdateAsync(user);
        return Ok(new AuthResponse(_tokenService.GenerateToken(user), user.Id, user.Email!));
    }

    // ---- Password reset ----

    // Always 204: the answer never tells whether an address has an account.
    [HttpPost("forgot-password", Name = "ForgotPassword")]
    [EnableRateLimiting(AuthRateLimit.Policy)]
    public async Task<IActionResult> ForgotPassword(ForgotPasswordRequest request, [FromServices] UserAdminService admin,
        [FromServices] Pako.Infrastructure.PakoDbContext db)
    {
        var user = await _userManager.FindByEmailAsync(request.Email?.Trim() ?? string.Empty);
        if (user is not null)
        {
            await admin.QueuePasswordResetAsync(user, null);
            await db.SaveChangesAsync();
        }

        return NoContent();
    }

    [HttpPost("reset-password", Name = "ResetPassword")]
    [EnableRateLimiting(AuthRateLimit.Policy)]
    public async Task<IActionResult> ResetPassword(ResetPasswordRequest request)
    {
        var user = await _userManager.FindByEmailAsync(request.Email?.Trim() ?? string.Empty);
        if (user is null) return BadRequest(_localizer["ResetLinkInvalid"].Value);

        var result = await _userManager.ResetPasswordAsync(user, request.Token, request.NewPassword);
        if (!result.Succeeded)
        {
            return BadRequest(result.Errors.Any(e => e.Code == "InvalidToken")
                ? _localizer["ResetLinkInvalid"].Value
                : string.Join(" ", result.Errors.Select(e => e.Description)));
        }

        // A reset also lifts a lockout.
        await _userManager.SetLockoutEndDateAsync(user, null);
        await _userManager.ResetAccessFailedCountAsync(user);
        return NoContent();
    }

    [Authorize]
    [HttpPost("verify-password")]
    public async Task<IActionResult> VerifyPassword(VerifyPasswordRequest request)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId is null) return Unauthorized();

        var user = await _userManager.FindByIdAsync(userId);
        if (user is null) return Unauthorized();

        var valid = await _userManager.CheckPasswordAsync(user, request.Password);
        if (!valid) return Unauthorized();

        return Ok();
    }

    [Authorize]
    [HttpPost("action-tokens")]
    [ProducesResponseType(typeof(ActionTokenResponse), StatusCodes.Status200OK)]
    public async Task<IActionResult> CreateActionToken(
        [FromBody] ActionTokenRequest request,
        [FromServices] ActionTokenService actionTokenService)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId is null) return Unauthorized();
        var userGuid = Guid.Parse(userId);

        if (actionTokenService.IsRateLimited(userGuid))
        {
            return StatusCode(StatusCodes.Status429TooManyRequests,
                _localizer["TooManyFailedAttempts"].Value);
        }

        var user = await _userManager.FindByIdAsync(userId);
        if (user is null) return Unauthorized();

        var valid = await _userManager.CheckPasswordAsync(user, request.Password);
        if (!valid)
        {
            actionTokenService.RecordFailedAttempt(userGuid);
            return Unauthorized();
        }

        actionTokenService.ResetFailedAttempts(userGuid);
        var (token, expiresAt) = actionTokenService.GenerateToken(userGuid, request.CompanyId, request.Action);
        return Ok(new ActionTokenResponse(token, expiresAt));
    }

    // ---- Account requests and the signed-in account (docs/PLATFORM_ADMIN.md) ----

    // Anyone may ask for an account. The answer is the same whether or not the email is already
    // known, so the form can't be used to find out who has an account.
    [HttpPost("account-requests", Name = "RequestAccount")]
    [EnableRateLimiting(AuthRateLimit.Policy)]
    public async Task<IActionResult> RequestAccount(AccountRequestRequest request, [FromServices] PlatformAdminService platform)
    {
        var error = await platform.SubmitRequestAsync(request);
        return error is null ? Ok() : BadRequest(error);
    }

    [Authorize]
    [HttpGet("me", Name = "GetMyAccount")]
    public async Task<ActionResult<MyAccountResponse>> Me([FromServices] PlatformAdminService platform)
    {
        var id = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (id is null || !Guid.TryParse(id, out var userId)) return Unauthorized();
        var me = await platform.MyAccountAsync(userId);
        return me is null ? Unauthorized() : Ok(me);
    }
}
