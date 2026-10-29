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
