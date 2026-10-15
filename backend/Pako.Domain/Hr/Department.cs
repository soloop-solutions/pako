namespace Pako.Domain.Hr;

public class Department
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public Guid? ParentId { get; set; }
    public Guid? ManagerEmployeeId { get; set; }

    // Payroll expense of this department's employees is tagged with this cost center through
    // JournalEntryLine.AnalyticDistribution (B14) — no per-dimension column on the JE line.
    public Guid? CostCenterId { get; set; }
    public bool IsActive { get; set; } = true;

    // Module permissions for ClientStaff members whose employee record sits in this department.
    // Ignored for every other membership role.
    public AccessLevel SalesAccess { get; set; }
    public AccessLevel PurchasesAccess { get; set; }
    public AccessLevel PartnersAccess { get; set; }
    public AccessLevel AccountingAccess { get; set; }
    public AccessLevel ReportsAccess { get; set; }
    public AccessLevel HrAccess { get; set; }
    public PartnerScope PartnerScope { get; set; } = PartnerScope.All;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // A partner-scoped user can't be given the general ledger: filtering a ledger by partner
    // hides the contra lines and misstates every balance, so Accounting is forced to None.
    public AccessLevel LevelFor(AccessModule module) => module switch
    {
        AccessModule.None => AccessLevel.Read,
        AccessModule.Sales => SalesAccess,
        AccessModule.Purchases => PurchasesAccess,
        AccessModule.Partners => PartnersAccess,
        AccessModule.Accounting => PartnerScope == PartnerScope.Assigned ? AccessLevel.None : AccountingAccess,
        AccessModule.Reports => ReportsAccess,
        AccessModule.Hr => HrAccess,
        _ => AccessLevel.None
    };
}
