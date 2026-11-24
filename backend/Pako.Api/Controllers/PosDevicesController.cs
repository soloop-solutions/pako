using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Hr;

namespace Pako.Api.Controllers;

// docs/POS_TILL_ACCESS.md §7 (user request 2026-11-24): till and kitchen screens sign in as devices
// that can reach the till and the kitchen display, nothing else. POS: Approve manages them.
[ApiController]
[Route("api/companies/{companyId:guid}/pos/devices")]
[Authorize]
public class PosDevicesController : ControllerBase
{
    private readonly PosDeviceService _devices;
    private readonly PosOperatorService _operators;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public PosDevicesController(PosDeviceService devices, PosOperatorService operators, IStringLocalizer<ErrorMessages> localizer)
    {
        _devices = devices;
        _operators = operators;
        _localizer = localizer;
    }

    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    private static PosDeviceResponse ToResponse(PosDeviceService.Device d) => new(d.Id, d.Name, d.Active, d.Connected, d.CreatedAt, d.LastSeenAt);

    private static string? CleanName(string? name) => name?.Trim() is { Length: > 0 and <= 80 } n ? n : null;

    [HttpGet(Name = "ListPosDevices")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    public async Task<ActionResult<List<PosDeviceResponse>>> List(Guid companyId) =>
        Ok((await _devices.ListAsync(companyId)).Select(ToResponse).ToList());

    // Adds a device and returns its first connect link.
    [HttpPost(Name = "CreatePosDevice")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos, approve: true)]
    public async Task<ActionResult<PosDeviceLinkResponse>> Create(Guid companyId, SavePosDeviceRequest request)
    {
        if (CleanName(request.Name) is not { } name) return BadRequest(_localizer["PosDeviceNameRequired"].Value);
        var device = await _devices.CreateAsync(companyId, name);
        var link = (await _devices.LinkAsync(companyId, device.Id))!.Value;
        return Ok(new PosDeviceLinkResponse(device.Id, device.Name, link.Code, link.ExpiresAt, link.PairCode));
    }

    [HttpPut("{deviceId:guid}", Name = "RenamePosDevice")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos, approve: true)]
    public async Task<IActionResult> Rename(Guid companyId, Guid deviceId, SavePosDeviceRequest request)
    {
        if (CleanName(request.Name) is not { } name) return BadRequest(_localizer["PosDeviceNameRequired"].Value);
        return await _devices.RenameAsync(companyId, deviceId, name) ? NoContent() : NotFound();
    }

    // A new link: for a new screen, or to switch a disconnected one back on. The old link stops working.
    [HttpPost("{deviceId:guid}/link", Name = "CreatePosDeviceLink")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos, approve: true)]
    public async Task<ActionResult<PosDeviceLinkResponse>> Link(Guid companyId, Guid deviceId)
    {
        if (await _devices.LinkAsync(companyId, deviceId) is not { } link) return NotFound();
        var device = (await _devices.ListAsync(companyId)).First(d => d.Id == deviceId);
        return Ok(new PosDeviceLinkResponse(device.Id, device.Name, link.Code, link.ExpiresAt, link.PairCode));
    }

    [HttpPost("{deviceId:guid}/disconnect", Name = "DisconnectPosDevice")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos, approve: true)]
    public async Task<IActionResult> Disconnect(Guid companyId, Guid deviceId) =>
        await _devices.DisconnectAsync(companyId, deviceId) ? NoContent() : NotFound();

    // The device disconnects itself (to be used as something else): a manager confirms with their
    // PIN, so a waiter can't sign the till out and log in as someone else.
    [HttpPost("me/disconnect", Name = "DisconnectThisPosDevice")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public async Task<IActionResult> DisconnectSelf(Guid companyId)
    {
        if (await _devices.DeviceOfAsync(CurrentUserId) is not { } device || device.CompanyId != companyId) return NotFound();
        if (await _operators.OperatorAsync(Request, companyId) is not { } op || !await _operators.CanApproveAsync(companyId, op))
        {
            return StatusCode(StatusCodes.Status403Forbidden, _localizer["PosDeviceNeedsManager"].Value);
        }
        await _devices.DisconnectAsync(companyId, CurrentUserId);
        return NoContent();
    }
}
