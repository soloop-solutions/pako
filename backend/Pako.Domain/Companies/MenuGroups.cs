using Pako.Domain.Hr;

namespace Pako.Domain.Companies;

// Client request 2026-11-24: menu groups by kind of work (sales team, warehouse, cashier,
// accountant, purchasing, manager). The web lists each group's pages first in the sidebar; which
// groups a user gets is decided here, from the user's role. Display only: every page keeps its own
// module permission check, and nothing becomes reachable through a group that was not before.
public static class MenuGroups
{
    public const string Sales = "sales";
    public const string Warehouse = "warehouse";
    public const string Cashier = "cashier";
    public const string Accountant = "accountant";
    public const string Purchasing = "purchasing";
    public const string Manager = "manager";

    /// <summary>Display order of the groups in the sidebar.</summary>
    public static readonly IReadOnlyList<string> All = new[] { Sales, Warehouse, Cashier, Purchasing, Accountant, Manager };

    /// <summary>
    /// A staff member's groups. A built-in role maps to its own groups; a custom role (or a built-in
    /// one whose levels were edited to nothing) gets a group for each area it may write in.
    /// HR, payroll, reports-only and read-only roles get none: their pages are in their own sections.
    /// </summary>
    public static IReadOnlyList<string> ForRole(string? builtInKey, Func<AccessModule, AccessLevel> levelFor, bool canManageUsers)
    {
        var groups = new HashSet<string>();
        switch (builtInKey)
        {
            case "sales": groups.Add(Sales); break;
            case "purchasing": groups.Add(Purchasing); groups.Add(Warehouse); break;
            case "cashier": groups.Add(Cashier); break;
            case "accountant": groups.Add(Accountant); break;
            case "hr" or "payroll" or "reports" or "readonly" or "employee": break;
            default:
                if (levelFor(AccessModule.Sales) >= AccessLevel.Write) groups.Add(Sales);
                if (levelFor(AccessModule.Inventory) >= AccessLevel.Write) groups.Add(Warehouse);
                if (levelFor(AccessModule.Pos) >= AccessLevel.Write) groups.Add(Cashier);
                if (levelFor(AccessModule.Purchases) >= AccessLevel.Write) groups.Add(Purchasing);
                if (levelFor(AccessModule.Accounting) >= AccessLevel.Write) groups.Add(Accountant);
                break;
        }

        // Whoever manages the company's users runs it: the manager's overview.
        if (canManageUsers) groups.Add(Manager);
        return Ordered(groups);
    }

    /// <summary>
    /// A member who is not staff: administrators (firm or client) get the manager's and the
    /// accountant's groups, the firm's accountant the accountant's, a client viewer the manager's.
    /// </summary>
    public static IReadOnlyList<string> ForMembership(IEnumerable<MembershipRole> roles)
    {
        var groups = new HashSet<string>();
        foreach (var role in roles)
        {
            switch (role)
            {
                case MembershipRole.FirmAdmin or MembershipRole.ClientAdmin:
                    groups.Add(Manager);
                    groups.Add(Accountant);
                    break;
                case MembershipRole.FirmAccountant:
                    groups.Add(Accountant);
                    break;
                case MembershipRole.ClientViewer:
                    groups.Add(Manager);
                    break;
            }
        }

        return Ordered(groups);
    }

    private static IReadOnlyList<string> Ordered(HashSet<string> groups) => All.Where(groups.Contains).ToList();
}
