using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Localization;
using Pako.Api.Contracts;
using Pako.Api.Desktop;
using Pako.Domain.Desktop;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/desktop/license")]
[Authorize]
public class DesktopLicenseController(
    DesktopLicenseService licenses,
    IStringLocalizer<ErrorMessages> localizer) : ControllerBase
{
    [HttpGet(Name = "GetDesktopLicense")]
    public async Task<ActionResult<DesktopLicenseResponse>> Get(CancellationToken ct) =>
        Ok(ToResponse(await licenses.EvaluateAsync(ct)));

    [HttpPost(Name = "ActivateDesktopLicense")]
    public async Task<ActionResult<DesktopLicenseResponse>> Activate(ActivateLicenseRequest request, CancellationToken ct)
    {
        var state = await licenses.ActivateAsync(request.LicenseKey ?? string.Empty, ct);
        if (state is null) return BadRequest(localizer["LicenseKeyInvalid"].Value);
        return Ok(ToResponse(state));
    }

    private static DesktopLicenseResponse ToResponse(LicenseState s) =>
        new(s.Status.ToString(), s.TrialDaysLeft, s.MachineCode, s.Customer, s.ExpiresAt);
}

public sealed class DesktopControllerFeatureProvider(bool enabled)
    : Microsoft.AspNetCore.Mvc.ApplicationParts.IApplicationFeatureProvider<Microsoft.AspNetCore.Mvc.Controllers.ControllerFeature>
{
    public void PopulateFeature(
        IEnumerable<Microsoft.AspNetCore.Mvc.ApplicationParts.ApplicationPart> parts,
        Microsoft.AspNetCore.Mvc.Controllers.ControllerFeature feature)
    {
        if (enabled) return;
        var hidden = feature.Controllers.Where(t => t.AsType() == typeof(DesktopLicenseController) || t.AsType() == typeof(DesktopSetupController) || t.AsType() == typeof(DesktopAuditController) || t.AsType() == typeof(DesktopRecoveryCodeController)).ToList();
        foreach (var t in hidden) feature.Controllers.Remove(t);
    }
}
