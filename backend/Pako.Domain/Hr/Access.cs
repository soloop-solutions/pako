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
    Hr,

    // F9 self-service (api/companies/{id}/me/...): any member whose login is linked to an active
    // employee of the company, whatever their role grants — even with no department.
    Self,

    // docs/USER_ACCESS_PLAN.md areas added with company roles. Payroll split out of Hr so pay
    // data has its own gate (QuickBooks/Odoo both separate it).
    Payroll,
    // docs/INVENTORY_PLAN.md D7: warehouses, stock documents, stock reports, and seeing cost/margin.
    Inventory,
    Items,
    Settings,
    Users
}

public enum AccessLevel
{
    None = 0,
    Read = 1,
    Write = 2,

    // Write plus the irreversible steps: post, approve/reject, pay, cancel/reverse.
    Approve = 3
}

// All: every partner of the company. Assigned: only the partners assigned to the employee
// (EmployeePartnerAssignment), and only documents that reference them — the ERPNext
// "User Permission on Customer" / Dolibarr "sales representative" model.
public enum PartnerScope
{
    All,
    Assigned
}
