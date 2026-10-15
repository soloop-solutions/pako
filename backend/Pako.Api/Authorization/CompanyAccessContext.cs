using Pako.Domain.Bills;
using Pako.Domain.Companies;
using Pako.Domain.Hr;
using Pako.Domain.Invoicing;

namespace Pako.Api.Authorization;

// What the current request may see inside {companyId}, resolved once by CompanyAccessFilter and
// injected (scoped) into controllers that serve partner-bearing data. Fail-closed: reading it
// before the filter resolved it throws, so a new endpoint that forgets [RequireCompanyAccess]
// can't silently fall through to "everything".
public class CompanyAccessContext
{
    private IReadOnlySet<Guid>? _visiblePartnerIds;
    private bool _resolved;

    public Guid CompanyId { get; private set; }
    public Guid UserId { get; private set; }
    public IReadOnlyList<MembershipRole> Roles { get; private set; } = Array.Empty<MembershipRole>();

    // Set only when access came through a ClientStaff membership.
    public Guid? EmployeeId { get; private set; }
    public Department? Department { get; private set; }

    // True when every applicable membership is ClientStaff — access comes from the department.
    public bool IsStaffAccess => EnsureResolved().EmployeeId is not null;

    // Null = every partner. Otherwise only these partners (and their documents) are visible.
    public IReadOnlySet<Guid>? VisiblePartnerIds => EnsureResolved()._visiblePartnerIds;

    public bool IsPartnerRestricted => VisiblePartnerIds is not null;

    public bool CanSeePartner(Guid partnerId) => VisiblePartnerIds is not { } ids || ids.Contains(partnerId);

    public bool CanSeePartner(Guid? partnerId) =>
        VisiblePartnerIds is not { } ids || (partnerId is { } id && ids.Contains(id));

    internal void ResolveUnrestricted(Guid companyId, Guid userId, IReadOnlyList<MembershipRole> roles)
    {
        CompanyId = companyId;
        UserId = userId;
        Roles = roles;
        EmployeeId = null;
        Department = null;
        _visiblePartnerIds = null;
        _resolved = true;
    }

    internal void ResolveStaff(Guid companyId, Guid userId, IReadOnlyList<MembershipRole> roles,
        Guid employeeId, Department department, IReadOnlySet<Guid>? visiblePartnerIds)
    {
        CompanyId = companyId;
        UserId = userId;
        Roles = roles;
        EmployeeId = employeeId;
        Department = department;
        _visiblePartnerIds = visiblePartnerIds;
        _resolved = true;
    }

    // For code paths that run without the MVC filter pipeline (tests constructing controllers
    // directly): full access, exactly what every pre-HR caller had.
    public static CompanyAccessContext Unrestricted(Guid companyId = default, Guid userId = default)
    {
        var context = new CompanyAccessContext();
        context.ResolveUnrestricted(companyId, userId, Array.Empty<MembershipRole>());
        return context;
    }

    public static CompanyAccessContext ForStaff(Guid companyId, Guid userId, Guid employeeId, Department department, IReadOnlySet<Guid>? visiblePartnerIds)
    {
        var context = new CompanyAccessContext();
        context.ResolveStaff(companyId, userId, new[] { MembershipRole.ClientStaff }, employeeId, department, visiblePartnerIds);
        return context;
    }

    private CompanyAccessContext EnsureResolved() => _resolved
        ? this
        : throw new InvalidOperationException("CompanyAccessContext read before CompanyAccessFilter resolved it — is the action missing [RequireCompanyAccess]?");
}

// One filter per partner-bearing document type. Kept as explicit overloads rather than a generic
// expression combinator so EF translates each to a plain IN (...) on the partner column.
public static class CompanyAccessQueryExtensions
{
    public static IQueryable<Invoice> VisibleTo(this IQueryable<Invoice> query, CompanyAccessContext access) =>
        access.VisiblePartnerIds is { } ids ? query.Where(i => ids.Contains(i.PartnerId)) : query;

    public static IQueryable<Bill> VisibleTo(this IQueryable<Bill> query, CompanyAccessContext access) =>
        access.VisiblePartnerIds is { } ids ? query.Where(b => ids.Contains(b.PartnerId)) : query;

    public static IQueryable<Partner> VisibleTo(this IQueryable<Partner> query, CompanyAccessContext access) =>
        access.VisiblePartnerIds is { } ids ? query.Where(p => ids.Contains(p.Id)) : query;
}
