using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Companies;
using Pako.Domain.Hr;
using Pako.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace Pako.Api.Controllers;

// docs/USER_ACCESS_PLAN.md: the administration dashboard. Reading needs Users: View; every change
// is user management (adminOnly: company/firm admins, or a role with Users: Approve).
[ApiController]
[Route("api/companies/{companyId:guid}/admin")]
[Authorize]
public class CompanyAdminController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly UserAdminService _admin;

    public CompanyAdminController(PakoDbContext db, UserAdminService admin)
    {
        _db = db;
        _admin = admin;
    }

    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    private ActionResult Result(string? error) => error is null ? NoContent() : BadRequest(error);

    // ---- Roles ----

    [HttpGet("roles", Name = "ListCompanyRoles")]
    [RequireCompanyAccess(module: AccessModule.Users)]
    public async Task<ActionResult<List<CompanyRoleResponse>>> Roles(Guid companyId) => Ok(await _admin.RolesAsync(companyId));

    [HttpPost("roles", Name = "CreateCompanyRole")]
    [RequireCompanyAccess(writeAccess: true, adminOnly: true)]
    [ProducesResponseType(typeof(CompanyRoleResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<CompanyRoleResponse>> CreateRole(Guid companyId, SaveCompanyRoleRequest request)
    {
        var result = await _admin.SaveRoleAsync(companyId, new CompanyRole(), request, CurrentUserId);
        if (result.Value is null) return BadRequest(result.Error);
        return StatusCode(StatusCodes.Status201Created, UserAdminService.ToResponse(result.Value, 0));
    }

    [HttpPut("roles/{roleId:guid}", Name = "UpdateCompanyRole")]
    [RequireCompanyAccess(writeAccess: true, adminOnly: true)]
    public async Task<ActionResult<CompanyRoleResponse>> UpdateRole(Guid companyId, Guid roleId, SaveCompanyRoleRequest request)
    {
        var role = await _db.CompanyRoles.FirstOrDefaultAsync(r => r.Id == roleId && r.CompanyId == companyId);
        if (role is null) return NotFound();
        var result = await _admin.SaveRoleAsync(companyId, role, request, CurrentUserId);
        if (result.Value is null) return BadRequest(result.Error);
        var users = await _db.Memberships.CountAsync(m => m.CompanyRoleId == roleId);
        return Ok(UserAdminService.ToResponse(result.Value, users));
    }

    [HttpDelete("roles/{roleId:guid}", Name = "DeleteCompanyRole")]
    [RequireCompanyAccess(writeAccess: true, adminOnly: true)]
    public async Task<IActionResult> DeleteRole(Guid companyId, Guid roleId) =>
        Result(await _admin.DeleteRoleAsync(companyId, roleId, CurrentUserId));

    // ---- Users and invitations ----

    [HttpGet("users", Name = "ListCompanyUsers")]
    [RequireCompanyAccess(module: AccessModule.Users)]
    public async Task<ActionResult<List<CompanyUserResponse>>> Users(Guid companyId) =>
        Ok(await _admin.UsersAsync(companyId, CurrentUserId));

    [HttpPost("invitations", Name = "InviteCompanyUser")]
    [RequireCompanyAccess(writeAccess: true, adminOnly: true)]
    public async Task<ActionResult<InvitationCreatedResponse>> Invite(Guid companyId, InviteUserRequest request)
    {
        var result = await _admin.InviteAsync(companyId, request, CurrentUserId);
        return result.Value is null ? BadRequest(result.Error) : Ok(result.Value);
    }

    [HttpPost("invitations/{invitationId:guid}/resend", Name = "ResendCompanyInvitation")]
    [RequireCompanyAccess(writeAccess: true, adminOnly: true)]
    public async Task<ActionResult<InvitationCreatedResponse>> Resend(Guid companyId, Guid invitationId)
    {
        var result = await _admin.ResendAsync(companyId, invitationId, CurrentUserId);
        return result.Value is null ? BadRequest(result.Error) : Ok(result.Value);
    }

    [HttpPost("invitations/{invitationId:guid}/revoke", Name = "RevokeCompanyInvitation")]
    [RequireCompanyAccess(writeAccess: true, adminOnly: true)]
    public async Task<IActionResult> Revoke(Guid companyId, Guid invitationId) =>
        Result(await _admin.RevokeAsync(companyId, invitationId, CurrentUserId));

    [HttpPut("users/{membershipId:guid}", Name = "UpdateCompanyUser")]
    [RequireCompanyAccess(writeAccess: true, adminOnly: true)]
    public async Task<IActionResult> UpdateUser(Guid companyId, Guid membershipId, UpdateCompanyUserRequest request) =>
        Result(await _admin.UpdateUserAsync(companyId, membershipId, request, CurrentUserId));

    [HttpPost("users/{membershipId:guid}/deactivate", Name = "DeactivateCompanyUser")]
    [RequireCompanyAccess(writeAccess: true, adminOnly: true)]
    public async Task<IActionResult> Deactivate(Guid companyId, Guid membershipId) =>
        Result(await _admin.SetActiveAsync(companyId, membershipId, false, CurrentUserId));

    [HttpPost("users/{membershipId:guid}/activate", Name = "ActivateCompanyUser")]
    [RequireCompanyAccess(writeAccess: true, adminOnly: true)]
    public async Task<IActionResult> Activate(Guid companyId, Guid membershipId) =>
        Result(await _admin.SetActiveAsync(companyId, membershipId, true, CurrentUserId));

    [HttpDelete("users/{membershipId:guid}", Name = "RemoveCompanyUser")]
    [RequireCompanyAccess(writeAccess: true, adminOnly: true)]
    public async Task<IActionResult> Remove(Guid companyId, Guid membershipId) =>
        Result(await _admin.RemoveAsync(companyId, membershipId, CurrentUserId));

    // Emails the user a reset link and returns it, so the admin can pass it on directly.
    [HttpPost("users/{membershipId:guid}/password-reset", Name = "SendCompanyUserPasswordReset")]
    [RequireCompanyAccess(writeAccess: true, adminOnly: true)]
    public async Task<ActionResult<PasswordResetLinkResponse>> PasswordReset(Guid companyId, Guid membershipId)
    {
        var result = await _admin.PasswordResetLinkAsync(companyId, membershipId, CurrentUserId);
        return result.Value is null ? BadRequest(result.Error) : Ok(new PasswordResetLinkResponse(result.Value));
    }
}
