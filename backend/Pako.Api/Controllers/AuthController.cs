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

    [HttpPost("verify-password")]
    [Authorize]
    public async Task<IActionResult> VerifyPassword(VerifyPasswordRequest request)
    {
        var userId = Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
        var user = await _userManager.FindByIdAsync(userId.ToString());
        if (user is null || !await _userManager.CheckPasswordAsync(user, request.Password))
            return Unauthorized();

        return Ok();
    }

    [HttpPost("action-tokens")]
    [Authorize]
    public async Task<ActionResult<ActionTokenResponse>> ActionTokens(ActionTokenRequest request)
    {
        var userId = Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

        if (_actionTokenService.IsRateLimited(userId))
            return StatusCode(StatusCodes.Status429TooManyRequests);

        var user = await _userManager.FindByIdAsync(userId.ToString());
        if (user is null || !await _userManager.CheckPasswordAsync(user, request.Password))
        {
            _actionTokenService.RecordFailedAttempt(userId);
            return Unauthorized();
        }

        _actionTokenService.ResetFailedAttempts(userId);

        if (!Guid.TryParse(request.CompanyId, out var companyId))
            return BadRequest("Invalid CompanyId");

        var (token, expiresAt) = _actionTokenService.GenerateToken(userId, companyId, request.Action);
        return Ok(new ActionTokenResponse(token, expiresAt));
    }
}
