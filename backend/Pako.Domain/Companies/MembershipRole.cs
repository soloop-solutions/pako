namespace Pako.Domain.Companies;

public enum MembershipRole
{
    FirmAdmin,
    FirmAccountant,
    ClientAdmin,
    ClientViewer,

    // A company's own employee with a login. Access comes from the employee's department
    // (module permissions + partner scope), never from the role itself.
    ClientStaff
}

public static class MembershipRoles
{
    // The access label the web shows for a membership ("Role" = a ClientStaff member under a CompanyRole).
    public static string AccessLabel(MembershipRole role) => role switch
    {
        MembershipRole.ClientAdmin => "Administrator",
        MembershipRole.ClientViewer => "ReadOnly",
        MembershipRole.FirmAdmin => "FirmAdmin",
        MembershipRole.FirmAccountant => "FirmAccountant",
        _ => "Role"
    };

    // The strongest full-access role among several memberships, for the header's role name.
    public static string StrongestLabel(IEnumerable<MembershipRole> roles)
    {
        var set = roles.ToHashSet();
        return AccessLabel(
            set.Contains(MembershipRole.FirmAdmin) ? MembershipRole.FirmAdmin
            : set.Contains(MembershipRole.FirmAccountant) ? MembershipRole.FirmAccountant
            : set.Contains(MembershipRole.ClientAdmin) ? MembershipRole.ClientAdmin
            : MembershipRole.ClientViewer);
    }
}
