using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Localization;
using Pako.Api.Contracts;
using Pako.Api.Services.Arbk;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/arbk")]
[Authorize]
public class ArbkController(IArbkRegistry registry, IStringLocalizer<ErrorMessages> localizer) : ControllerBase
{
    private const int MinNameLength = 3;

    [HttpGet("search")]
    public async Task<ActionResult<List<ArbkBusinessResponse>>> Search(
        [FromQuery] string? q = null,
        [FromQuery] string? nui = null,
        [FromQuery] string? fiscal = null,
        CancellationToken cancellationToken = default)
    {
        var name = q?.Trim();
        if (string.IsNullOrEmpty(nui?.Trim()) && string.IsNullOrEmpty(fiscal?.Trim()) && (name is null || name.Length < MinNameLength))
            return BadRequest(string.Format(localizer["ArbkSearchParamRequired"].Value, MinNameLength));

        try
        {
            return Ok((await registry.SearchAsync(name, nui, fiscal, cancellationToken)).ToList());
        }
        catch (ArbkNotConfiguredException)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, localizer["ArbkNotConfigured"].Value);
        }
        catch (ArbkUnavailableException)
        {
            return StatusCode(StatusCodes.Status502BadGateway, localizer["ArbkUnavailable"].Value);
        }
    }

    [HttpGet("{registrationId}")]
    public async Task<ActionResult<ArbkBusinessResponse>> Details(string registrationId, CancellationToken cancellationToken = default)
    {
        try
        {
            var business = await registry.GetDetailsAsync(registrationId, cancellationToken);
            return business is null ? NotFound() : Ok(business);
        }
        catch (ArbkNotConfiguredException)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, localizer["ArbkNotConfigured"].Value);
        }
        catch (ArbkUnavailableException)
        {
            return StatusCode(StatusCodes.Status502BadGateway, localizer["ArbkUnavailable"].Value);
        }
    }
}
