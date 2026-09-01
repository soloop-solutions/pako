using Pako.Domain.Companies;
using Pako.Domain.Ledger;
using Pako.Localization.Xk;

namespace Pako.Tests;

// The startup validation test COA_V2_IMPLEMENTATION_BRIEF.md Stage 2 asks for: every seeded row
// satisfies the class/group invariant, every DefaultVatCode resolves to a real VAT code, every
// CitDeductibility = Limit row has a CitLimitRule, plus (this repo's own addition, not asked for
// by name but stated as a hard rule just above that test in the brief) no seeded code occupies
// the 90-99-per-group range reserved for client-specific accounts.
public class ChartOfAccountsV2TemplateTests
{
    [Fact]
    public void Entries_HasExactly233Rows()
    {
        Assert.Equal(233, ChartOfAccountsV2Template.Entries.Count);
    }

    [Fact]
    public void Entries_EveryRowSatisfiesCodeClassGroupInvariant()
    {
        foreach (var entry in ChartOfAccountsV2Template.Entries)
        {
            Assert.Equal(entry.Code[0].ToString(), entry.Class.ToString());
            Assert.Equal(entry.Code[..2], entry.Group.ToString("D2"));
        }
    }

    [Fact]
    public void Entries_EveryDefaultVatCodeResolvesToARealVatCode()
    {
        foreach (var entry in ChartOfAccountsV2Template.Entries)
        {
            Assert.Contains(entry.DefaultVatCode, VatCodeReference.Codes);
        }
    }

    // The brief asks for "every CitDeductibility = Limit row has a CitLimitRule" — the actual
    // source CSV doesn't fully satisfy that: these 5 codes have CIT = LIMIT with no note text at
    // all (verified directly against the CSV, not a parsing bug). Per the brief's own rule 5
    // ("seed it and tag it — do not guess a better value, and do not omit the row"), they're
    // seeded with CitLimitRule = null rather than an invented explanation. This test documents
    // the gap explicitly so it's discoverable, not asserts a false invariant.
    private static readonly HashSet<string> LimitRowsWithNoRuleTextInSource =
        new() { "223100", "600700", "640200", "640600", "710400" };

    [Fact]
    public void Entries_EveryLimitDeductibilityRowHasACitLimitRule_ExceptTheDocumentedSourceGaps()
    {
        foreach (var entry in ChartOfAccountsV2Template.Entries)
        {
            if (entry.CitDeductibility != CitDeductibility.Limit)
            {
                Assert.Null(entry.CitLimitRule);
            }
            else if (LimitRowsWithNoRuleTextInSource.Contains(entry.Code))
            {
                Assert.Null(entry.CitLimitRule);
            }
            else
            {
                Assert.False(string.IsNullOrWhiteSpace(entry.CitLimitRule));
            }
        }
    }

    [Fact]
    public void Entries_NoCodeOccupiesTheReservedNinetyToNinetyNineRange()
    {
        foreach (var entry in ChartOfAccountsV2Template.Entries)
        {
            var suffix = entry.Code[^2..];
            Assert.True(string.CompareOrdinal(suffix, "90") < 0, $"{entry.Code} occupies the reserved 90-99 range.");
        }
    }

    [Fact]
    public void Entries_CodesAreUnique()
    {
        var codes = ChartOfAccountsV2Template.Entries.Select(e => e.Code).ToList();
        Assert.Equal(codes.Count, codes.Distinct().Count());
    }

    [Theory]
    [InlineData(CompanyProfile.Core, 167)]
    [InlineData(CompanyProfile.Import, 167 + 22)]
    [InlineData(CompanyProfile.Mfg, 167 + 5)]
    [InlineData(CompanyProfile.Serv, 167 + 8)]
    [InlineData(CompanyProfile.Payroll, 167 + 13)]
    [InlineData(CompanyProfile.IfrsPlus, 167 + 18)]
    [InlineData(CompanyProfile.Import | CompanyProfile.Payroll, 167 + 22 + 13)]
    public void ForProfiles_MatchesThe50ProfilesRowCounts(CompanyProfile profiles, int expectedCount)
    {
        Assert.Equal(expectedCount, ChartOfAccountsV2Template.ForProfiles(profiles).Count());
    }

    [Fact]
    public void ForProfiles_AllSixProfilesTogetherCoverAllEntries()
    {
        var all = CompanyProfile.Core | CompanyProfile.Import | CompanyProfile.Mfg |
                   CompanyProfile.Serv | CompanyProfile.Payroll | CompanyProfile.IfrsPlus;

        Assert.Equal(233, ChartOfAccountsV2Template.ForProfiles(all).Count());
    }

    [Theory]
    [InlineData(1, NormalBalance.Debit, AccountType.Asset)]
    [InlineData(1, NormalBalance.Credit, AccountType.Asset)]
    [InlineData(2, NormalBalance.Credit, AccountType.Liability)]
    [InlineData(3, NormalBalance.Debit, AccountType.Equity)]
    [InlineData(4, NormalBalance.Debit, AccountType.Income)]
    [InlineData(4, NormalBalance.Credit, AccountType.Income)]
    [InlineData(5, NormalBalance.Debit, AccountType.Expense)]
    [InlineData(6, NormalBalance.Debit, AccountType.Expense)]
    [InlineData(7, NormalBalance.Credit, AccountType.Income)]
    [InlineData(7, NormalBalance.Debit, AccountType.Expense)]
    public void AccountTypeDerivation_MatchesExpected(int accountClass, NormalBalance normalBalance, AccountType expected)
    {
        Assert.Equal(expected, AccountTypeDerivation.DeriveAccountType(accountClass, normalBalance));
    }

    [Fact]
    public void AccountTypeDerivation_EveryClass7RowInTheRealSeedDerivesCorrectly()
    {
        foreach (var entry in ChartOfAccountsV2Template.Entries.Where(e => e.Class == 7))
        {
            var derived = AccountTypeDerivation.DeriveAccountType(entry.Class, entry.NormalBalance);
            var expected = entry.NormalBalance == NormalBalance.Credit ? AccountType.Income : AccountType.Expense;
            Assert.Equal(expected, derived);
        }
    }
}
