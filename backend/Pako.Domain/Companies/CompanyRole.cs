using Pako.Domain.Hr;

namespace Pako.Domain.Companies;

// docs/USER_ACCESS_PLAN.md: a named set of permissions a company admin gives to users (one role per
// user) — QuickBooks Online Advanced "custom roles" / Odoo app groups. One level per area plus a
// partner scope (Odoo "own documents" / QuickBooks "limited to customers").
public class CompanyRole
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }

    // Seeded template key (e.g. "accountant"); null for roles the admin created.
    public string? BuiltInKey { get; set; }

    public AccessLevel SalesAccess { get; set; }
    public AccessLevel PurchasesAccess { get; set; }
    public AccessLevel PartnersAccess { get; set; }
    public AccessLevel ItemsAccess { get; set; }
    public AccessLevel AccountingAccess { get; set; }
    public AccessLevel ReportsAccess { get; set; }
    public AccessLevel HrAccess { get; set; }
    public AccessLevel PayrollAccess { get; set; }
    public AccessLevel SettingsAccess { get; set; }
    public AccessLevel UsersAccess { get; set; }
    public PartnerScope PartnerScope { get; set; } = PartnerScope.All;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public static readonly AccessModule[] Areas =
    {
        AccessModule.Sales, AccessModule.Purchases, AccessModule.Partners, AccessModule.Items, AccessModule.Accounting,
        AccessModule.Reports, AccessModule.Hr, AccessModule.Payroll, AccessModule.Settings, AccessModule.Users
    };

    // A partner-scoped role can't hold the general ledger: filtering a ledger by partner hides the
    // contra lines and misstates every balance, so Accounting is forced to None.
    public AccessLevel LevelFor(AccessModule module) => module switch
    {
        AccessModule.None => AccessLevel.Read,
        AccessModule.Sales => SalesAccess,
        AccessModule.Purchases => PurchasesAccess,
        AccessModule.Partners => PartnersAccess,
        AccessModule.Items => ItemsAccess,
        AccessModule.Accounting => PartnerScope == PartnerScope.Assigned ? AccessLevel.None : AccountingAccess,
        AccessModule.Reports => ReportsAccess,
        AccessModule.Hr => HrAccess,
        AccessModule.Payroll => PayrollAccess,
        AccessModule.Settings => SettingsAccess,
        AccessModule.Users => UsersAccess,
        _ => AccessLevel.None
    };

    public void Set(AccessModule module, AccessLevel level)
    {
        switch (module)
        {
            case AccessModule.Sales: SalesAccess = level; break;
            case AccessModule.Purchases: PurchasesAccess = level; break;
            case AccessModule.Partners: PartnersAccess = level; break;
            case AccessModule.Items: ItemsAccess = level; break;
            case AccessModule.Accounting: AccountingAccess = level; break;
            case AccessModule.Reports: ReportsAccess = level; break;
            case AccessModule.Hr: HrAccess = level; break;
            case AccessModule.Payroll: PayrollAccess = level; break;
            case AccessModule.Settings: SettingsAccess = level; break;
            case AccessModule.Users: UsersAccess = level; break;
            default: throw new ArgumentOutOfRangeException(nameof(module), module, "Not a role area.");
        }
    }

    public bool CanManageUsers => UsersAccess >= AccessLevel.Approve;

    // ---- Built-in templates (docs/USER_ACCESS_PLAN.md §3) ----

    public record Template(string Key, string NameSq, string NameEn, string DescriptionSq, string DescriptionEn,
        IReadOnlyDictionary<AccessModule, AccessLevel> Levels, PartnerScope Scope = PartnerScope.All);

    private const AccessLevel V = AccessLevel.Read, E = AccessLevel.Write, A = AccessLevel.Approve;

    public static readonly IReadOnlyList<Template> Templates = new[]
    {
        new Template("accountant", "Kontabilist", "Accountant",
            "Kontabiliteti i plotë, shitjet, blerjet dhe pagat.", "Full bookkeeping, sales, purchases and payroll.",
            new Dictionary<AccessModule, AccessLevel>
            {
                [AccessModule.Sales] = A, [AccessModule.Purchases] = A, [AccessModule.Partners] = E, [AccessModule.Items] = E,
                [AccessModule.Accounting] = A, [AccessModule.Reports] = V, [AccessModule.Hr] = V, [AccessModule.Payroll] = A,
                [AccessModule.Settings] = E
            }),
        new Template("sales", "Shitje", "Sales",
            "Harton faturat e shitjes dhe menaxhon klientët; nuk poston.", "Drafts sales invoices and manages customers; does not post.",
            new Dictionary<AccessModule, AccessLevel>
            {
                [AccessModule.Sales] = E, [AccessModule.Partners] = E, [AccessModule.Items] = V, [AccessModule.Reports] = V
            }),
        new Template("purchasing", "Blerje", "Purchasing",
            "Harton faturat e blerjes dhe menaxhon furnitorët dhe artikujt.", "Drafts bills and manages vendors and items.",
            new Dictionary<AccessModule, AccessLevel>
            {
                [AccessModule.Purchases] = E, [AccessModule.Partners] = E, [AccessModule.Items] = E, [AccessModule.Reports] = V
            }),
        new Template("hr", "Zyrtar HR", "HR officer",
            "Punonjësit, departamentet, pushimet dhe orët; pa paga.", "Employees, departments, leave and timesheets; no pay data.",
            new Dictionary<AccessModule, AccessLevel> { [AccessModule.Hr] = A }),
        new Template("payroll", "Zyrtar pagash", "Payroll officer",
            "HR dhe pagat, përfshirë postimin dhe pagesën e listëpagesave.", "HR and payroll, including posting and paying runs.",
            new Dictionary<AccessModule, AccessLevel> { [AccessModule.Hr] = A, [AccessModule.Payroll] = A, [AccessModule.Reports] = V }),
        new Template("reports", "Vetëm raporte", "Reports only",
            "Shikon raportet; asgjë tjetër.", "Views reports; nothing else.",
            new Dictionary<AccessModule, AccessLevel> { [AccessModule.Reports] = V }),
        new Template("readonly", "Vetëm lexim", "Read only",
            "Shikon gjithçka përveç pagave dhe përdoruesve.", "Views everything except payroll and users.",
            new Dictionary<AccessModule, AccessLevel>
            {
                [AccessModule.Sales] = V, [AccessModule.Purchases] = V, [AccessModule.Partners] = V, [AccessModule.Items] = V,
                [AccessModule.Accounting] = V, [AccessModule.Reports] = V, [AccessModule.Hr] = V, [AccessModule.Settings] = V
            }),
        new Template("employee", "Punonjës", "Employee",
            "Vetëm \"HR-ja ime\": fletëpagesat, pushimet dhe shpenzimet e veta.", "Only \"My HR\": own payslips, leave and expenses.",
            new Dictionary<AccessModule, AccessLevel>())
    };

    public static CompanyRole FromTemplate(Guid companyId, Template template)
    {
        var role = new CompanyRole
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            BuiltInKey = template.Key,
            Name = template.NameSq,
            Description = template.DescriptionSq,
            PartnerScope = template.Scope
        };
        foreach (var (area, level) in template.Levels) role.Set(area, level);
        return role;
    }
}
