using Pako.Domain.Ledger;

namespace Pako.Localization.Xk;

// B2: the 7 class-level and 28 group-level rows that cover every (Class, Group) pair present in
// PAKO_COA_v2_seed.csv (verified 1:1 against ChartOfAccountsV2TemplateTests). Names are PAKO's
// own — the source CSV has no group-name column, only the numeric Class/Group codes — chosen from
// what each group's own member accounts actually are.
public record AccountGroupTemplateEntry(int Class, int? Group, string Name);

public static class AccountGroupTemplate
{
    public static readonly IReadOnlyList<AccountGroupTemplateEntry> Entries = new List<AccountGroupTemplateEntry>
    {
        // Class 1 — Assets
        new(1, null, "Assets"),
        new(1, 10, "Cash and Cash Equivalents"),
        new(1, 11, "Receivables"),
        new(1, 12, "Inventory"),
        new(1, 13, "Prepaid Expenses & Other Current Assets"),
        new(1, 14, "Investments"),
        new(1, 15, "Fixed Assets"),

        // Class 2 — Liabilities
        new(2, null, "Liabilities"),
        new(2, 20, "Payables"),
        new(2, 21, "VAT Payable"),
        new(2, 22, "Payroll Liabilities"),
        new(2, 23, "Short-term Loans"),
        new(2, 24, "Accrued Expenses"),

        // Class 3 — Equity
        new(3, null, "Equity"),
        new(3, 30, "Share Capital & Reserves"),

        // Class 4 — Revenue
        new(4, null, "Revenue"),
        new(4, 40, "Sales Revenue"),
        new(4, 41, "Service Revenue"),
        new(4, 42, "Other Operating Income"),

        // Class 5 — Cost of Sales
        new(5, null, "Cost of Sales"),
        new(5, 50, "Cost of Goods Sold"),
        new(5, 51, "Import & Customs Costs"),
        new(5, 52, "Inventory Adjustments"),

        // Class 6 — Operating Expenses
        new(6, null, "Operating Expenses"),
        new(6, 60, "Personnel Costs"),
        new(6, 61, "Occupancy Costs"),
        new(6, 62, "Subscriptions & Software"),
        new(6, 63, "Marketing & Advertising"),
        new(6, 64, "Vehicle & Fuel Costs"),
        new(6, 65, "Depreciation & Amortization"),
        new(6, 66, "Bank & Finance Charges"),

        // Class 7 — Financial & Tax
        new(7, null, "Financial & Tax"),
        new(7, 70, "Financial Income"),
        new(7, 71, "Financial Expenses"),
        new(7, 72, "Income Tax"),
    };

    // Builds one AccountGroup row per entry for a company, wiring each Group-level row's
    // ParentGroupId to its Class-level row. Six-digit range per entry: a Class row spans its
    // whole digit (1 -> 100000-199999), a Group row spans its two digits (10 -> 100000-109999).
    public static List<AccountGroup> BuildForCompany(Guid companyId)
    {
        var groups = new List<AccountGroup>();
        var classGroupIds = new Dictionary<int, Guid>();

        foreach (var entry in Entries.Where(e => e.Group is null))
        {
            var id = Guid.NewGuid();
            classGroupIds[entry.Class] = id;
            groups.Add(new AccountGroup
            {
                Id = id,
                CompanyId = companyId,
                Name = entry.Name,
                CodePrefixStart = $"{entry.Class}00000",
                CodePrefixEnd = $"{entry.Class}99999",
                ParentGroupId = null
            });
        }

        foreach (var entry in Entries.Where(e => e.Group is not null))
        {
            groups.Add(new AccountGroup
            {
                Id = Guid.NewGuid(),
                CompanyId = companyId,
                Name = entry.Name,
                CodePrefixStart = $"{entry.Group!.Value:00}0000",
                CodePrefixEnd = $"{entry.Group!.Value:00}9999",
                ParentGroupId = classGroupIds[entry.Class]
            });
        }

        return groups;
    }
}
