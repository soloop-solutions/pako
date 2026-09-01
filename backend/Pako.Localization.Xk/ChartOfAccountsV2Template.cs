using System.Reflection;
using System.Text;
using Pako.Domain.Companies;
using Pako.Domain.Ledger;

namespace Pako.Localization.Xk;

// Plani Kontabel v2.0 (COA_V2_IMPLEMENTATION_BRIEF.md Stage 2). One row per account from
// PAKO_COA_v2_seed.csv (10_COA_Master), typed. CitLimitRule is only ever non-null where
// CitDeductibility == Limit (the CSV's own "note" column for that row).
public record ChartOfAccountsV2TemplateEntry(
    string Code,
    string NameSq,
    string NameEn,
    int Class,
    int Group,
    AccountStatement Statement,
    NormalBalance NormalBalance,
    SubledgerType Subledger,
    string DefaultVatCode,
    CitDeductibility CitDeductibility,
    CompanyProfile Profile,
    string? CitLimitRule);

// Parses the embedded PAKO_COA_v2_seed.csv once (on first access to Entries, cached from then
// on) rather than a 233-entry C# collection literal — the CSV is the artifact accountants will
// edit, per the implementation brief.
public static class ChartOfAccountsV2Template
{
    public static readonly IReadOnlyList<ChartOfAccountsV2TemplateEntry> Entries = Load();

    // R04: control accounts accept only subledger-document postings, never a manual journal
    // entry (not enforced until Stage 4 — this is just the fact of which codes they are).
    public static readonly IReadOnlySet<string> ControlAccountCodes =
        new HashSet<string> { "110100", "110200", "200100", "200200" };

    // 50_Profiles: "When a company is created, PAKO activates CORE plus the profiles selected."
    public static IEnumerable<ChartOfAccountsV2TemplateEntry> ForProfiles(CompanyProfile enabledProfiles)
    {
        var effective = enabledProfiles | CompanyProfile.Core;
        return Entries.Where(e => (effective & e.Profile) == e.Profile);
    }

    private static IReadOnlyList<ChartOfAccountsV2TemplateEntry> Load()
    {
        var assembly = typeof(ChartOfAccountsV2Template).Assembly;
        const string resourceName = "Pako.Localization.Xk.Data.PAKO_COA_v2_seed.csv";
        using var stream = assembly.GetManifestResourceStream(resourceName)
            ?? throw new InvalidOperationException($"Embedded resource '{resourceName}' not found.");
        using var reader = new StreamReader(stream, Encoding.UTF8);

        var entries = new List<ChartOfAccountsV2TemplateEntry>();
        reader.ReadLine(); // header: code,name_sq,name_en,class,group,statement,normal_balance,subledger,default_vat_code,cit_deductibility,profile,status,note

        string? line;
        while ((line = reader.ReadLine()) != null)
        {
            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            var f = ParseCsvLine(line);
            var citDeductibility = ParseCitDeductibility(f[9]);

            entries.Add(new ChartOfAccountsV2TemplateEntry(
                Code: f[0],
                NameSq: f[1],
                NameEn: f[2],
                Class: int.Parse(f[3]),
                Group: int.Parse(f[4]),
                Statement: f[5] == "BS" ? AccountStatement.BalanceSheet : AccountStatement.IncomeStatement,
                NormalBalance: f[6] == "D" ? NormalBalance.Debit : NormalBalance.Credit,
                Subledger: ParseSubledger(f[7]),
                DefaultVatCode: f[8],
                CitDeductibility: citDeductibility,
                Profile: ParseProfile(f[10]),
                // 5 rows genuinely have CIT = LIMIT with no note text in the source CSV
                // (223100, 600700, 640200, 640600, 710400) — a real gap in the source data, not
                // a parsing bug. Seeded as null rather than inventing an explanation; see
                // ChartOfAccountsV2TemplateTests for the documented list.
                CitLimitRule: citDeductibility == CitDeductibility.Limit && !string.IsNullOrWhiteSpace(f[12]) ? f[12] : null));
        }

        return entries;
    }

    private static SubledgerType ParseSubledger(string value) => value switch
    {
        "-" => SubledgerType.None,
        "PARTNER" => SubledgerType.Partner,
        "ITEM" => SubledgerType.Item,
        "ASSET" => SubledgerType.Asset,
        "EMPLOYEE" => SubledgerType.Employee,
        "BANK" => SubledgerType.Bank,
        "CASH" => SubledgerType.Cash,
        "TAX" => SubledgerType.Tax,
        "CUSTOMS" => SubledgerType.Customs,
        _ => throw new FormatException($"Unknown Subledger value '{value}' in PAKO_COA_v2_seed.csv.")
    };

    private static CitDeductibility ParseCitDeductibility(string value) => value switch
    {
        "FULL" => CitDeductibility.Full,
        "LIMIT" => CitDeductibility.Limit,
        "NON" => CitDeductibility.Non,
        "NA" => CitDeductibility.Na,
        _ => throw new FormatException($"Unknown CIT value '{value}' in PAKO_COA_v2_seed.csv.")
    };

    private static CompanyProfile ParseProfile(string value) => value switch
    {
        "CORE" => CompanyProfile.Core,
        "IMPORT" => CompanyProfile.Import,
        "MFG" => CompanyProfile.Mfg,
        "SERV" => CompanyProfile.Serv,
        "PAYROLL" => CompanyProfile.Payroll,
        "IFRS+" => CompanyProfile.IfrsPlus,
        _ => throw new FormatException($"Unknown Profile value '{value}' in PAKO_COA_v2_seed.csv.")
    };

    // Minimal RFC4180 field splitter — handles quoted fields with embedded commas and doubled
    // quotes ("" inside a quoted field), which is as much as this CSV's "note" column needs
    // (no field spans multiple lines). Not a general-purpose CSV library: this file's 13-column
    // shape is fixed and small (233 rows), so a hand-rolled parser avoids adding a dependency.
    private static string[] ParseCsvLine(string line)
    {
        var fields = new List<string>();
        var field = new StringBuilder();
        var inQuotes = false;

        for (var i = 0; i < line.Length; i++)
        {
            var c = line[i];
            if (inQuotes)
            {
                if (c == '"')
                {
                    if (i + 1 < line.Length && line[i + 1] == '"')
                    {
                        field.Append('"');
                        i++;
                    }
                    else
                    {
                        inQuotes = false;
                    }
                }
                else
                {
                    field.Append(c);
                }
            }
            else if (c == '"')
            {
                inQuotes = true;
            }
            else if (c == ',')
            {
                fields.Add(field.ToString());
                field.Clear();
            }
            else
            {
                field.Append(c);
            }
        }

        fields.Add(field.ToString());
        return fields.ToArray();
    }
}
