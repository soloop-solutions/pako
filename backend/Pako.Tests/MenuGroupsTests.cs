using Pako.Domain.Hr;
using Pako.Domain.Companies;
using Xunit;

namespace Pako.Tests;

// Client request 2026-11-24: which sidebar menu groups a user gets from their role.
public class MenuGroupsTests
{
    private static Func<AccessModule, AccessLevel> LevelsOf(string key)
    {
        var role = new CompanyRole();
        foreach (var (module, level) in CompanyRole.Templates.Single(t => t.Key == key).Levels) role.Set(module, level);
        return role.LevelFor;
    }

    [Theory]
    [InlineData("sales", new[] { MenuGroups.Sales })]
    [InlineData("purchasing", new[] { MenuGroups.Warehouse, MenuGroups.Purchasing })]
    [InlineData("cashier", new[] { MenuGroups.Cashier })]
    [InlineData("accountant", new[] { MenuGroups.Accountant })]
    [InlineData("hr", new string[0])]
    [InlineData("payroll", new string[0])]
    [InlineData("readonly", new string[0])]
    public void BuiltInRole_GetsItsOwnGroups(string key, string[] expected)
    {
        Assert.Equal(expected, MenuGroups.ForRole(key, LevelsOf(key), canManageUsers: false));
    }

    [Fact]
    public void CustomRole_GetsAGroupForEachAreaItMayWriteIn_InSidebarOrder()
    {
        var role = new CompanyRole();
        role.Set(AccessModule.Accounting, AccessLevel.Approve);
        role.Set(AccessModule.Pos, AccessLevel.Write);
        role.Set(AccessModule.Sales, AccessLevel.Read);
        role.Set(AccessModule.Inventory, AccessLevel.Write);

        Assert.Equal(new[] { MenuGroups.Warehouse, MenuGroups.Cashier, MenuGroups.Accountant },
            MenuGroups.ForRole(null, role.LevelFor, canManageUsers: false));
    }

    [Fact]
    public void RoleThatManagesUsers_AlsoGetsTheManagersGroup()
    {
        Assert.Equal(new[] { MenuGroups.Sales, MenuGroups.Manager }, MenuGroups.ForRole("sales", LevelsOf("sales"), canManageUsers: true));
    }

    [Fact]
    public void Members_AdminsGetManagerAndAccountant_FirmAccountantAccountant_ViewerManager()
    {
        Assert.Equal(new[] { MenuGroups.Accountant, MenuGroups.Manager }, MenuGroups.ForMembership(new[] { MembershipRole.ClientAdmin }));
        Assert.Equal(new[] { MenuGroups.Accountant, MenuGroups.Manager }, MenuGroups.ForMembership(new[] { MembershipRole.FirmAdmin }));
        Assert.Equal(new[] { MenuGroups.Accountant }, MenuGroups.ForMembership(new[] { MembershipRole.FirmAccountant }));
        Assert.Equal(new[] { MenuGroups.Manager }, MenuGroups.ForMembership(new[] { MembershipRole.ClientViewer }));
        Assert.Empty(MenuGroups.ForMembership(new[] { MembershipRole.ClientStaff }));
        // Several roles: every matching group, once.
        Assert.Equal(new[] { MenuGroups.Accountant, MenuGroups.Manager },
            MenuGroups.ForMembership(new[] { MembershipRole.FirmAccountant, MembershipRole.ClientViewer }));
    }
}
