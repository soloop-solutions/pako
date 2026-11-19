using Pako.Domain.Hr;

namespace Pako.Domain.Companies;

// The parts of PAKO a platform administrator switches on or off per company. A module that is off
// is gone for everyone in that company: its menus disappear and its API refuses requests.
// Partners, items, settings, users and the dashboard are always on.
[Flags]
public enum AppModule
{
    None = 0,
    Sales = 1,
    Purchases = 2,
    Accounting = 4,
    Reports = 8,
    Hr = 16,
    Payroll = 32,
    // docs/INVENTORY_PLAN.md D7: warehouses, stock documents and stock reports.
    Inventory = 64,
    // docs/POS_PLAN.md D14: registers, sessions, the till and fiscal coupons.
    Pos = 128,
    All = Sales | Purchases | Accounting | Reports | Hr | Payroll | Inventory | Pos
}

public static class AppModules
{
    public static readonly AppModule[] Selectable =
        { AppModule.Sales, AppModule.Purchases, AppModule.Accounting, AppModule.Reports, AppModule.Hr, AppModule.Payroll, AppModule.Inventory, AppModule.Pos };

    // Which switchable module an access area belongs to; null = always available.
    public static AppModule? For(AccessModule area) => area switch
    {
        AccessModule.Sales => AppModule.Sales,
        AccessModule.Purchases => AppModule.Purchases,
        AccessModule.Accounting => AppModule.Accounting,
        AccessModule.Reports => AppModule.Reports,
        AccessModule.Hr or AccessModule.Self => AppModule.Hr,
        AccessModule.Payroll => AppModule.Payroll,
        AccessModule.Inventory => AppModule.Inventory,
        AccessModule.Pos => AppModule.Pos,
        _ => null
    };

    public static bool IsEnabled(AppModule enabled, AccessModule area) =>
        For(area) is not { } module || enabled.HasFlag(module);
}
