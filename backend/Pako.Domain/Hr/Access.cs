namespace Pako.Domain.Hr;

// The module areas a ClientStaff user's department grants access to. None on an endpoint means
// "general reference data" (taxes, accounts list, the company itself) — staff may read it but
// never write through it.
public enum AccessModule
{
    None,
    Sales,
    Purchases,
    Partners,
    Accounting,
    Reports,
    Hr
}

public enum AccessLevel
{
    None = 0,
    Read = 1,
    Write = 2
}

// All: every partner of the company. Assigned: only the partners assigned to the employee
// (EmployeePartnerAssignment), and only documents that reference them — the ERPNext
// "User Permission on Customer" / Dolibarr "sales representative" model.
public enum PartnerScope
{
    All,
    Assigned
}
