using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Platform;

namespace Pako.Api.Controllers;

// docs/PLATFORM_ADMIN.md: the admin panel above every company — usage, users and their company
// limits, account requests, and each company's modules. Platform administrators only.
[ApiController]
[Route("api/platform")]
[Authorize]
[RequirePlatformAdmin]
public class PlatformAdminController : ControllerBase
{
    private readonly PlatformAdminService _platform;

    public PlatformAdminController(PlatformAdminService platform) => _platform = platform;

    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet("overview", Name = "GetPlatformOverview")]
    public async Task<ActionResult<PlatformOverviewResponse>> Overview() => Ok(await _platform.OverviewAsync());

    [HttpGet("users", Name = "ListPlatformUsers")]
    public async Task<ActionResult<List<PlatformUserResponse>>> Users([FromQuery] string? search = null) =>
        Ok(await _platform.ListUsersAsync(search));

    [HttpPut("users/{userId:guid}", Name = "UpdatePlatformUser")]
    public async Task<IActionResult> UpdateUser(Guid userId, UpdatePlatformUserRequest request)
    {
        var error = await _platform.UpdateUserAsync(userId, request, CurrentUserId);
        return error is null ? NoContent() : BadRequest(error);
    }

    [HttpGet("account-requests", Name = "ListAccountRequests")]
    public async Task<ActionResult<List<AccountRequestResponse>>> Requests([FromQuery] AccountRequestStatus? status = null) =>
        Ok(await _platform.ListRequestsAsync(status));

    [HttpPost("account-requests/{id:guid}/approve", Name = "ApproveAccountRequest")]
    public async Task<ActionResult<ApproveAccountRequestResponse>> Approve(Guid id, ApproveAccountRequestRequest request)
    {
        var (result, error) = await _platform.ApproveAsync(id, request, CurrentUserId);
        return error is null ? Ok(result) : BadRequest(error);
    }

    [HttpPost("account-requests/{id:guid}/reject", Name = "RejectAccountRequest")]
    public async Task<ActionResult<AccountRequestResponse>> Reject(Guid id, RejectAccountRequestRequest request)
    {
        var (result, error) = await _platform.RejectAsync(id, request.Note, CurrentUserId);
        return error is null ? Ok(result) : BadRequest(error);
    }

    [HttpGet("companies", Name = "ListPlatformCompanies")]
    public async Task<ActionResult<List<PlatformCompanyResponse>>> Companies([FromQuery] string? search = null, [FromQuery] Guid? createdBy = null) =>
        Ok(await _platform.ListCompaniesAsync(search, createdBy));

    [HttpPut("companies/{companyId:guid}/modules", Name = "UpdateCompanyModules")]
    public async Task<ActionResult<PlatformCompanyResponse>> UpdateModules(Guid companyId, UpdateCompanyModulesRequest request)
    {
        var (result, error) = await _platform.UpdateModulesAsync(companyId, request.Modules, CurrentUserId);
        return error is null ? Ok(result) : BadRequest(error);
    }
}
