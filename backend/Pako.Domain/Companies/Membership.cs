namespace Pako.Domain.Companies;

// A membership grants a user either firm-wide access (cascades to every Company under that
// FirmId) or access to a single Company directly. Exactly one of FirmId/CompanyId is set, and
// the Role must match that scope — enforced here and, defense-in-depth, by a Postgres CHECK
// constraint added in the AddFirmsAndMemberships migration.
public class Membership
{
    private static readonly MembershipRole[] FirmRoles = { MembershipRole.FirmAdmin, MembershipRole.FirmAccountant };
    private static readonly MembershipRole[] ClientRoles = { MembershipRole.ClientAdmin, MembershipRole.ClientViewer };

    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public Guid? FirmId { get; set; }
    public Guid? CompanyId { get; set; }
    public MembershipRole Role { get; set; }

    public static Membership ForFirm(Guid userId, Guid firmId, MembershipRole role)
    {
        if (!FirmRoles.Contains(role))
        {
            throw new ArgumentException($"{role} is not a valid firm-scoped role.", nameof(role));
        }

        return new Membership { Id = Guid.NewGuid(), UserId = userId, FirmId = firmId, Role = role };
    }

    public static Membership ForCompany(Guid userId, Guid companyId, MembershipRole role)
    {
        if (!ClientRoles.Contains(role))
        {
            throw new ArgumentException($"{role} is not a valid company-scoped role.", nameof(role));
        }

        return new Membership { Id = Guid.NewGuid(), UserId = userId, CompanyId = companyId, Role = role };
    }
}
