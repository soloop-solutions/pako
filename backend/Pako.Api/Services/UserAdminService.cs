using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Microsoft.Extensions.Options;
using Pako.Api.Contracts;
using Pako.Api.Services.Notifications;
using Pako.Domain.Companies;
using Pako.Domain.Hr;
using Pako.Domain.Notifications;
using Pako.Infrastructure;
using Pako.Infrastructure.Identity;

namespace Pako.Api.Services;

public record AdminResult<T>(T? Value, string? Error)
{
    public static AdminResult<T> Fail(string error) => new(default, error);
}

// docs/USER_ACCESS_PLAN.md: everything the administration dashboard does — roles, users,
// invitations — plus accepting an invitation. Every change is audited.
public class UserAdminService
{
    private readonly PakoDbContext _db;
    private readonly UserManager<AppUser> _users;
    private readonly NotificationOutbox _outbox;
    private readonly EmailOptions _email;
    private readonly IStringLocalizer<ErrorMessages> _localizer;
    private readonly Pako.Api.Auth.PlatformOptions _platform;

    // platform is optional only so tests can construct the service directly.
    public UserAdminService(
        PakoDbContext db, UserManager<AppUser> users, NotificationOutbox outbox, IOptions<EmailOptions> email,
        IStringLocalizer<ErrorMessages> localizer, IOptions<Pako.Api.Auth.PlatformOptions>? platform = null)
    {
        _db = db;
        _users = users;
        _outbox = outbox;
        _email = email.Value;
        _localizer = localizer;
        _platform = platform?.Value ?? new Pako.Api.Auth.PlatformOptions();
    }

    private string AppUrl => _email.AppBaseUrl.TrimEnd('/');

    // See EmailOptions.ShowLinksToAdmins: empty when the link went out by real email only.
    private string LinkForAdmin(string url) => _email.ShowLinksToAdmins ? url : string.Empty;

    // ---- Roles ----

    // Seeds the built-in roles once per company (a company that renamed or deleted them is never
    // re-seeded for those keys).
    public async Task EnsureBuiltInRolesAsync(Guid companyId)
    {
        var existing = await _db.CompanyRoles.Where(r => r.CompanyId == companyId).Select(r => new { r.BuiltInKey, r.Name }).ToListAsync();
        if (existing.Any(r => r.BuiltInKey != null)) return;

        var names = existing.Select(r => r.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var template in CompanyRole.Templates)
        {
            var role = CompanyRole.FromTemplate(companyId, template);
            if (names.Contains(role.Name)) role.Name = $"{role.Name} ({template.NameEn})";
            _db.CompanyRoles.Add(role);
        }

        await _db.SaveChangesAsync();
    }

    public async Task<List<CompanyRoleResponse>> RolesAsync(Guid companyId)
    {
        await EnsureBuiltInRolesAsync(companyId);
        var roles = await _db.CompanyRoles.AsNoTracking().Where(r => r.CompanyId == companyId).OrderBy(r => r.Name).ToListAsync();
        var counts = await _db.Memberships.AsNoTracking()
            .Where(m => m.CompanyId == companyId && m.CompanyRoleId != null)
            .GroupBy(m => m.CompanyRoleId!.Value)
            .Select(g => new { g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Key, x => x.Count);
        return roles.Select(r => ToResponse(r, counts.GetValueOrDefault(r.Id))).ToList();
    }

    public static ModuleAccessResponse Levels(CompanyRole r) => new(
        r.LevelFor(AccessModule.Sales), r.LevelFor(AccessModule.Purchases), r.LevelFor(AccessModule.Partners),
        r.LevelFor(AccessModule.Accounting), r.LevelFor(AccessModule.Reports), r.LevelFor(AccessModule.Hr),
        r.LevelFor(AccessModule.Items), r.LevelFor(AccessModule.Payroll), r.LevelFor(AccessModule.Settings), r.LevelFor(AccessModule.Users),
        r.LevelFor(AccessModule.Inventory), r.LevelFor(AccessModule.Pos));

    public static CompanyRoleResponse ToResponse(CompanyRole r, int users) =>
        new(r.Id, r.Name, r.Description, r.BuiltInKey, Levels(r), r.PartnerScope, users);

    public async Task<AdminResult<CompanyRole>> SaveRoleAsync(Guid companyId, CompanyRole role, SaveCompanyRoleRequest request, Guid actor)
    {
        var name = request.Name?.Trim() ?? string.Empty;
        if (name.Length is 0 or > 80) return AdminResult<CompanyRole>.Fail(_localizer["RoleNameRequired"].Value);
        if (await _db.CompanyRoles.AnyAsync(r => r.CompanyId == companyId && r.Name == name && r.Id != role.Id))
        {
            return AdminResult<CompanyRole>.Fail(_localizer["RoleNameTaken"].Value);
        }

        var isNew = role.Id == Guid.Empty;
        if (isNew)
        {
            role.Id = Guid.NewGuid();
            role.CompanyId = companyId;
            _db.CompanyRoles.Add(role);
        }

        role.Name = name;
        role.Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim();
        role.PartnerScope = request.PartnerScope;
        var l = request.Levels;
        role.Set(AccessModule.Sales, l.Sales);
        role.Set(AccessModule.Purchases, l.Purchases);
        role.Set(AccessModule.Partners, l.Partners);
        role.Set(AccessModule.Accounting, l.Accounting);
        role.Set(AccessModule.Reports, l.Reports);
        role.Set(AccessModule.Hr, l.Hr);
        role.Set(AccessModule.Items, l.Items);
        role.Set(AccessModule.Payroll, l.Payroll);
        role.Set(AccessModule.Settings, l.Settings);
        role.Set(AccessModule.Users, l.Users);
        role.Set(AccessModule.Inventory, l.Inventory);
        role.Set(AccessModule.Pos, l.Pos);

        Audit(companyId, "CompanyRole", role.Id, isNew ? "Create" : "Update", actor);
        await _db.SaveChangesAsync();
        return new AdminResult<CompanyRole>(role, null);
    }

    public async Task<string?> DeleteRoleAsync(Guid companyId, Guid roleId, Guid actor)
    {
        var role = await _db.CompanyRoles.FirstOrDefaultAsync(r => r.Id == roleId && r.CompanyId == companyId);
        if (role is null) return _localizer["RoleNotFound"].Value;
        if (await _db.Memberships.AnyAsync(m => m.CompanyRoleId == roleId))
        {
            return _localizer["RoleInUse"].Value;
        }

        _db.CompanyRoles.Remove(role);
        Audit(companyId, "CompanyRole", role.Id, "Delete", actor);
        await _db.SaveChangesAsync();
        return null;
    }

    // ---- Users ----

    public async Task<List<CompanyUserResponse>> UsersAsync(Guid companyId, Guid currentUserId)
    {
        var company = await _db.Companies.AsNoTracking().FirstAsync(c => c.Id == companyId);
        var memberships = await _db.Memberships.AsNoTracking()
            .Where(m => m.CompanyId == companyId || (company.FirmId != null && m.FirmId == company.FirmId))
            .ToListAsync();
        var userIds = memberships.Select(m => m.UserId).Distinct().ToList();
        var users = await _db.Users.AsNoTracking().Where(u => userIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, u => new { u.Email, u.FullName, u.LastLoginAt });
        var roles = await _db.CompanyRoles.AsNoTracking().Where(r => r.CompanyId == companyId).ToDictionaryAsync(r => r.Id, r => r.Name);
        var employees = await _db.Employees.AsNoTracking()
            .Where(e => e.CompanyId == companyId && e.UserId != null)
            .ToDictionaryAsync(e => e.UserId!.Value, e => new { e.Id, e.Name });

        var rows = memberships.Select(m =>
        {
            var user = users.GetValueOrDefault(m.UserId);
            var employee = employees.GetValueOrDefault(m.UserId);
            var access = MembershipRoles.AccessLabel(m.Role);
            return new CompanyUserResponse(m.Id, null, m.UserId, user?.Email ?? string.Empty, user?.FullName ?? employee?.Name, access,
                m.CompanyRoleId, m.CompanyRoleId is { } r ? roles.GetValueOrDefault(r) : null, employee?.Id, employee?.Name,
                m.IsActive ? "Active" : "Deactivated", user?.LastLoginAt, null, m.FirmId != null, m.UserId == currentUserId);
        }).ToList();

        var now = DateTime.UtcNow;
        var invitations = await _db.UserInvitations.AsNoTracking()
            .Where(i => i.CompanyId == companyId && i.AcceptedAt == null && i.RevokedAt == null)
            .OrderByDescending(i => i.CreatedAt)
            .ToListAsync();
        var invitedEmployees = await _db.Employees.AsNoTracking()
            .Where(e => invitations.Select(i => i.EmployeeId).Contains(e.Id))
            .ToDictionaryAsync(e => e.Id, e => e.Name);
        rows.AddRange(invitations.Select(i => InvitationRow(i, roles, invitedEmployees, now)));

        return rows.OrderBy(r => r.IsFirmMember).ThenBy(r => r.Status == "Deactivated").ThenBy(r => r.FullName ?? r.Email).ToList();
    }

    private static CompanyUserResponse InvitationRow(UserInvitation i, IReadOnlyDictionary<Guid, string> roles, IReadOnlyDictionary<Guid, string> employees, DateTime now) =>
        new(null, i.Id, null, i.Email, i.FullName, i.Role == MembershipRole.ClientAdmin ? "Administrator" : "Role",
            i.CompanyRoleId, i.CompanyRoleId is { } r ? roles.GetValueOrDefault(r) : null,
            i.EmployeeId, i.EmployeeId is { } e ? employees.GetValueOrDefault(e) : null,
            i.IsOpen(now) ? "Invited" : "Expired", null, i.CreatedAt, false, false);

    public async Task<AdminResult<InvitationCreatedResponse>> InviteAsync(Guid companyId, InviteUserRequest request, Guid actor)
    {
        var email = request.Email?.Trim() ?? string.Empty;
        if (!email.Contains('@') || email.Length > 256) return AdminResult<InvitationCreatedResponse>.Fail(_localizer["InviteEmailInvalid"].Value);
        if (await ValidateAssignmentAsync(companyId, request.Administrator, request.RoleId, request.EmployeeId, null) is { } error)
        {
            return AdminResult<InvitationCreatedResponse>.Fail(error);
        }

        var existing = await _users.FindByEmailAsync(email);
        if (existing is not null && await _db.Memberships.AnyAsync(m => m.UserId == existing.Id && m.CompanyId == companyId))
        {
            return AdminResult<InvitationCreatedResponse>.Fail(string.Format(_localizer["AlreadyCompanyMember"].Value, email));
        }

        // A new invitation replaces any open one for the same address.
        var now = DateTime.UtcNow;
        foreach (var open in await _db.UserInvitations.Where(i => i.CompanyId == companyId && i.Email == email && i.AcceptedAt == null && i.RevokedAt == null).ToListAsync())
        {
            open.RevokedAt = now;
        }

        var (invitation, token) = UserInvitation.Create(companyId, email, request.FullName,
            request.Administrator ? MembershipRole.ClientAdmin : MembershipRole.ClientStaff,
            request.Administrator ? null : request.RoleId, request.EmployeeId, actor, now);
        _db.UserInvitations.Add(invitation);
        var url = await QueueInvitationEmailAsync(invitation, token, actor);
        Audit(companyId, "UserInvitation", invitation.Id, "Invite", actor);
        await _db.SaveChangesAsync();

        var roles = await _db.CompanyRoles.AsNoTracking().Where(r => r.CompanyId == companyId).ToDictionaryAsync(r => r.Id, r => r.Name);
        var employees = await _db.Employees.AsNoTracking().Where(e => e.Id == invitation.EmployeeId).ToDictionaryAsync(e => e.Id, e => e.Name);
        return new AdminResult<InvitationCreatedResponse>(new InvitationCreatedResponse(InvitationRow(invitation, roles, employees, now), LinkForAdmin(url), invitation.ExpiresAt), null);
    }

    public async Task<AdminResult<InvitationCreatedResponse>> ResendAsync(Guid companyId, Guid invitationId, Guid actor)
    {
        var invitation = await _db.UserInvitations.FirstOrDefaultAsync(i => i.Id == invitationId && i.CompanyId == companyId && i.AcceptedAt == null && i.RevokedAt == null);
        if (invitation is null) return AdminResult<InvitationCreatedResponse>.Fail(_localizer["InvitationNotFound"].Value);

        // A fresh token and expiry: the old link stops working.
        var now = DateTime.UtcNow;
        var (fresh, token) = UserInvitation.Create(companyId, invitation.Email, invitation.FullName, invitation.Role,
            invitation.CompanyRoleId, invitation.EmployeeId, actor, now);
        invitation.TokenHash = fresh.TokenHash;
        invitation.ExpiresAt = fresh.ExpiresAt;
        var url = await QueueInvitationEmailAsync(invitation, token, actor);
        Audit(companyId, "UserInvitation", invitation.Id, "Resend", actor);
        await _db.SaveChangesAsync();

        var roles = await _db.CompanyRoles.AsNoTracking().Where(r => r.CompanyId == companyId).ToDictionaryAsync(r => r.Id, r => r.Name);
        return new AdminResult<InvitationCreatedResponse>(
            new InvitationCreatedResponse(InvitationRow(invitation, roles, new Dictionary<Guid, string>(), now), LinkForAdmin(url), invitation.ExpiresAt), null);
    }

    public async Task<string?> RevokeAsync(Guid companyId, Guid invitationId, Guid actor)
    {
        var invitation = await _db.UserInvitations.FirstOrDefaultAsync(i => i.Id == invitationId && i.CompanyId == companyId && i.AcceptedAt == null);
        if (invitation is null) return _localizer["InvitationNotFound"].Value;
        invitation.RevokedAt ??= DateTime.UtcNow;
        Audit(companyId, "UserInvitation", invitation.Id, "Revoke", actor);
        await _db.SaveChangesAsync();
        return null;
    }

    private async Task<string> QueueInvitationEmailAsync(UserInvitation invitation, string token, Guid actor)
    {
        var url = $"{AppUrl}/accept-invite?token={Uri.EscapeDataString(token)}";
        var company = await _db.Companies.AsNoTracking().Where(c => c.Id == invitation.CompanyId).Select(c => c.Name).FirstAsync();
        var inviter = await _db.Users.AsNoTracking().Where(u => u.Id == actor).Select(u => u.FullName ?? u.Email).FirstOrDefaultAsync();
        await _outbox.EnqueueAsync(invitation.CompanyId, NotificationTemplates.UserInvitation,
            new[] { new NotificationRecipient(invitation.Email, NotificationOutbox.DefaultCulture) },
            new Dictionary<string, string>
            {
                ["company"] = company,
                ["inviter"] = inviter ?? company,
                ["link"] = url,
                ["days"] = UserInvitation.ExpiryDays.ToString()
            });
        return url;
    }

    public async Task<string?> UpdateUserAsync(Guid companyId, Guid membershipId, UpdateCompanyUserRequest request, Guid actor)
    {
        var membership = await _db.Memberships.FirstOrDefaultAsync(m => m.Id == membershipId && m.CompanyId == companyId);
        if (membership is null) return _localizer["MemberNotFound"].Value;
        if (await ValidateAssignmentAsync(companyId, request.Administrator, request.RoleId, request.EmployeeId, membership.UserId) is { } error) return error;

        var wasAdmin = membership.Role == MembershipRole.ClientAdmin;
        if (wasAdmin && !request.Administrator && membership.IsActive && !await HasAnotherAdminAsync(companyId, membership.Id))
        {
            return _localizer["LastAdministrator"].Value;
        }

        membership.Role = request.Administrator ? MembershipRole.ClientAdmin : MembershipRole.ClientStaff;
        membership.CompanyRoleId = request.Administrator ? null : request.RoleId;
        await LinkEmployeeAsync(companyId, membership.UserId, request.EmployeeId);
        Audit(companyId, "Membership", membership.Id, "ChangeAccess", actor);
        await _db.SaveChangesAsync();
        return null;
    }

    public async Task<string?> SetActiveAsync(Guid companyId, Guid membershipId, bool active, Guid actor)
    {
        var membership = await _db.Memberships.FirstOrDefaultAsync(m => m.Id == membershipId && m.CompanyId == companyId);
        if (membership is null) return _localizer["MemberNotFound"].Value;
        if (!active)
        {
            if (membership.UserId == actor) return _localizer["CannotDeactivateSelf"].Value;
            if (membership.Role == MembershipRole.ClientAdmin && !await HasAnotherAdminAsync(companyId, membership.Id))
            {
                return _localizer["LastAdministrator"].Value;
            }
        }

        membership.IsActive = active;
        Audit(companyId, "Membership", membership.Id, active ? "Activate" : "Deactivate", actor);
        await _db.SaveChangesAsync();
        return null;
    }

    public async Task<string?> RemoveAsync(Guid companyId, Guid membershipId, Guid actor)
    {
        var membership = await _db.Memberships.FirstOrDefaultAsync(m => m.Id == membershipId && m.CompanyId == companyId);
        if (membership is null) return _localizer["MemberNotFound"].Value;
        if (membership.UserId == actor) return _localizer["CannotDeactivateSelf"].Value;
        if (membership.Role == MembershipRole.ClientAdmin && !await HasAnotherAdminAsync(companyId, membership.Id))
        {
            return _localizer["LastAdministrator"].Value;
        }

        // The employee record stays (HR history); only its login link goes.
        foreach (var employee in await _db.Employees.Where(e => e.CompanyId == companyId && e.UserId == membership.UserId).ToListAsync())
        {
            employee.UserId = null;
        }

        _db.Memberships.Remove(membership);
        Audit(companyId, "Membership", membership.Id, "Remove", actor);
        await _db.SaveChangesAsync();
        return null;
    }

    public async Task<AdminResult<string>> PasswordResetLinkAsync(Guid companyId, Guid membershipId, Guid actor)
    {
        var membership = await _db.Memberships.AsNoTracking().FirstOrDefaultAsync(m => m.Id == membershipId && m.CompanyId == companyId);
        if (membership is null) return AdminResult<string>.Fail(_localizer["MemberNotFound"].Value);
        var user = await _users.FindByIdAsync(membership.UserId.ToString());
        if (user?.Email is null) return AdminResult<string>.Fail(_localizer["MemberNotFound"].Value);

        // A company admin may reset only a login that belongs to this company alone: never another
        // administrator, a platform administrator, or someone with access to other companies — the
        // password is the same everywhere, so that would hand over their other access too.
        var elsewhere = await _db.Memberships.AnyAsync(m => m.UserId == user.Id && m.IsActive && m.CompanyId != companyId);
        if (user.IsPlatformAdmin || membership.Role != MembershipRole.ClientStaff || elsewhere)
        {
            return AdminResult<string>.Fail(_localizer["PasswordResetNotAllowed"].Value);
        }

        var url = await QueuePasswordResetAsync(user, companyId);
        Audit(companyId, "Membership", membership.Id, "PasswordReset", actor);
        await _db.SaveChangesAsync();
        return new AdminResult<string>(LinkForAdmin(url), null);
    }

    public async Task<string> QueuePasswordResetAsync(AppUser user, Guid? companyId)
    {
        var token = await _users.GeneratePasswordResetTokenAsync(user);
        var url = $"{AppUrl}/reset-password?email={Uri.EscapeDataString(user.Email!)}&token={Uri.EscapeDataString(token)}";
        await _outbox.EnqueueAsync(companyId, NotificationTemplates.PasswordReset,
            new[] { new NotificationRecipient(user.Email!, NotificationOutbox.DefaultCulture) },
            new Dictionary<string, string> { ["link"] = url });
        return url;
    }

    // ---- Accepting an invitation (anonymous) ----

    public async Task<UserInvitation?> OpenInvitationAsync(string token)
    {
        var hash = UserInvitation.Hash(token ?? string.Empty);
        var invitation = await _db.UserInvitations.FirstOrDefaultAsync(i => i.TokenHash == hash);
        return invitation is not null && invitation.IsOpen(DateTime.UtcNow) ? invitation : null;
    }

    public async Task<AdminResult<AppUser>> AcceptAsync(AcceptInvitationRequest request)
    {
        var invitation = await OpenInvitationAsync(request.Token);
        if (invitation is null) return AdminResult<AppUser>.Fail(_localizer["InvitationInvalid"].Value);

        var user = await _users.FindByEmailAsync(invitation.Email);
        if (user is null)
        {
            // A platform-administrator address is never created through someone else's invitation:
            // whoever holds the link would otherwise become the administrator at first sign-in.
            if (_platform.IsAdminEmail(invitation.Email)) return AdminResult<AppUser>.Fail(_localizer["InvitationInvalid"].Value);

            user = new AppUser
            {
                UserName = invitation.Email,
                Email = invitation.Email,
                EmailConfirmed = true, // they proved it by opening the emailed link
                FullName = string.IsNullOrWhiteSpace(request.FullName) ? invitation.FullName : request.FullName.Trim()
            };
            var created = await _users.CreateAsync(user, request.Password);
            if (!created.Succeeded) return AdminResult<AppUser>.Fail(string.Join(" ", created.Errors.Select(e => e.Description)));
        }
        else
        {
            // The address already has a PAKO login: joining needs that login's password, under the
            // same lockout as signing in, and never for a disabled account.
            if (user.IsDisabled) return AdminResult<AppUser>.Fail(_localizer["AccountDisabled"].Value);
            if (await _users.IsLockedOutAsync(user)) return AdminResult<AppUser>.Fail(_localizer["AccountLocked"].Value);
            if (!await _users.CheckPasswordAsync(user, request.Password))
            {
                await _users.AccessFailedAsync(user);
                return AdminResult<AppUser>.Fail(_localizer["InvitationWrongPassword"].Value);
            }
            await _users.ResetAccessFailedCountAsync(user);
        }

        if (!await _db.Memberships.AnyAsync(m => m.UserId == user.Id && m.CompanyId == invitation.CompanyId))
        {
            var membership = Membership.ForCompany(user.Id, invitation.CompanyId, invitation.Role);
            membership.CompanyRoleId = invitation.Role == MembershipRole.ClientStaff ? invitation.CompanyRoleId : null;
            _db.Memberships.Add(membership);
        }

        await LinkEmployeeAsync(invitation.CompanyId, user.Id, invitation.EmployeeId);
        invitation.AcceptedAt = DateTime.UtcNow;
        Audit(invitation.CompanyId, "UserInvitation", invitation.Id, "Accept", user.Id);
        await _db.SaveChangesAsync();
        return new AdminResult<AppUser>(user, null);
    }

    // ---- Helpers ----

    private async Task<string?> ValidateAssignmentAsync(Guid companyId, bool administrator, Guid? roleId, Guid? employeeId, Guid? userId)
    {
        if (!administrator)
        {
            if (roleId is not { } id || !await _db.CompanyRoles.AnyAsync(r => r.Id == id && r.CompanyId == companyId))
            {
                return _localizer["RoleRequired"].Value;
            }
        }

        if (employeeId is { } employee)
        {
            var linked = await _db.Employees.AsNoTracking().Where(e => e.Id == employee && e.CompanyId == companyId).Select(e => new { e.UserId }).FirstOrDefaultAsync();
            if (linked is null) return _localizer["EmployeeNotFound"].Value;
            if (linked.UserId is { } other && other != userId) return _localizer["EmployeeUserTaken"].Value;
        }

        return null;
    }

    private async Task LinkEmployeeAsync(Guid companyId, Guid userId, Guid? employeeId)
    {
        var current = await _db.Employees.Where(e => e.CompanyId == companyId && e.UserId == userId).ToListAsync();
        foreach (var e in current.Where(e => e.Id != employeeId)) e.UserId = null;
        if (employeeId is { } id && current.All(e => e.Id != id))
        {
            var employee = await _db.Employees.FirstAsync(e => e.Id == id && e.CompanyId == companyId);
            employee.UserId ??= userId;
        }
    }

    // Another active administrator — a company admin, or an admin of the firm managing it.
    private async Task<bool> HasAnotherAdminAsync(Guid companyId, Guid exceptMembershipId)
    {
        var firmId = await _db.Companies.AsNoTracking().Where(c => c.Id == companyId).Select(c => c.FirmId).FirstAsync();
        return await _db.Memberships.AnyAsync(m => m.Id != exceptMembershipId && m.IsActive &&
            ((m.CompanyId == companyId && m.Role == MembershipRole.ClientAdmin) ||
             (firmId != null && m.FirmId == firmId && m.Role == MembershipRole.FirmAdmin)));
    }

    private void Audit(Guid companyId, string entity, Guid id, string action, Guid actor) =>
        Pako.Api.Controllers.AuditController.Stage(_db, companyId, entity, id.ToString(), action, actor.ToString());
}
