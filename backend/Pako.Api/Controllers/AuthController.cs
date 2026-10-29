using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Localization;
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

    public AuthController(UserManager<AppUser> userManager, IJwtTokenService tokenService,
        IStringLocalizer<ErrorMessages> localizer, ActionTokenService actionTokenService)
    {
        _userManager = userManager;
        _tokenService = tokenService;
        _localizer = localizer;
        _actionTokenService = actionTokenService;
    }

    [HttpPost("register")]
    public async Task<ActionResult<AuthResponse>> Register(RegisterRequest request)
    {
        var user = new AppUser { UserName = request.Email, Email = request.Email };
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
    public async Task<ActionResult<AuthResponse>> Login(LoginRequest request)
    {
        var user = await _userManager.FindByEmailAsync(request.Email);
        if (user is null || !await _userManager.CheckPasswordAsync(user, request.Password))
        {
            return Unauthorized();
        }

        var token = _tokenService.GenerateToken(user);
        return Ok(new AuthResponse(token, user.Id, user.Email!));
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
}
