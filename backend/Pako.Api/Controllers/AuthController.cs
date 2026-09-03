using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Localization;
using Pako.Api.Auth;
using Pako.Api.Contracts;
using Pako.Infrastructure.Identity;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController : ControllerBase
{
    private readonly UserManager<AppUser> _userManager;
    private readonly IJwtTokenService _tokenService;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public AuthController(UserManager<AppUser> userManager, IJwtTokenService tokenService, IStringLocalizer<ErrorMessages> localizer)
    {
        _userManager = userManager;
        _tokenService = tokenService;
        _localizer = localizer;
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
}
