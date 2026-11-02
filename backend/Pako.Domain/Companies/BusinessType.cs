namespace Pako.Domain.Companies;

// docs/COMPANY_TYPES.md — what kind of business a company is. The type picks the vertical packs
// (CompanyFeature) the company sees and, when a company is created, the modules it starts with.
// General keeps everything on: an accounting client, or a business that mixes several trades.
public enum BusinessType
{
    General = 0,
    // Supermarket, mini-market, butcher, kiosk, shop.
    Market = 1,
    // Restaurant, café, bar, fast food, pizzeria.
    Restaurant = 2,
    // Hotel or guest house (with its restaurant and events).
    Hotel = 3,
    // Salon, barber, clinic, gym, repair shop.
    Services = 4,
    Pharmacy = 5,
    FuelStation = 6,
    // Wholesale and van sales.
    Wholesale = 7,
    Construction = 8,
    // Building developer, property sales and rentals.
    RealEstate = 9,
    AutoParts = 10,
}

// The vertical packs (docs/POS_PLAN.md §9.1). A pack switched off hides its pages and its API
// answers 403; the platform administrator can switch packs on or off per company.
[Flags]
public enum CompanyFeature : long
{
    None = 0,
    // Weighed goods, deposits, scale labels, promotions at the till.
    Grocery = 1,
    // Tables, tabs, kitchen tickets, menu and modifiers.
    Hospitality = 2,
    // Appointments, resources, packages, memberships, repairs.
    Services = 4,
    // Rooms, bookings, folios, guest register.
    Hotel = 8,
    // Venues, event bookings, ticketed events.
    Events = 16,
    // Prescriptions, payers, controlled register.
    Pharmacy = 32,
    // Tanks, nozzles, meter readings, fleet cards.
    Forecourt = 64,
    // Vans, routes, visits, van load and settlement.
    Distribution = 128,
    // Webshop and marketplace channels, cash on delivery.
    OnlineSales = 256,
    // Cross-references and vehicle fitment.
    AutoParts = 512,
    // Sites, cost codes, bills of quantities, progress bills.
    Construction = 1024,
    // Buildings, units, reservations, sale contracts.
    RealEstate = 2048,
    // Leases, meters, rent runs.
    Rentals = 4096,
    All = Grocery | Hospitality | Services | Hotel | Events | Pharmacy | Forecourt | Distribution | OnlineSales | AutoParts | Construction
        | RealEstate | Rentals,
}

public static class BusinessTypes
{
    public static readonly CompanyFeature[] Selectable =
    {
        CompanyFeature.Grocery, CompanyFeature.Hospitality, CompanyFeature.Services, CompanyFeature.Hotel, CompanyFeature.Events,
        CompanyFeature.Pharmacy, CompanyFeature.Forecourt, CompanyFeature.Distribution, CompanyFeature.OnlineSales,
        CompanyFeature.AutoParts, CompanyFeature.Construction, CompanyFeature.RealEstate, CompanyFeature.Rentals,
    };

    private const AppModule Office = AppModule.Sales | AppModule.Purchases | AppModule.Accounting | AppModule.Reports | AppModule.Hr | AppModule.Payroll;

    // The packs a business of this type uses.
    public static CompanyFeature Features(BusinessType type) => type switch
    {
        BusinessType.Market => CompanyFeature.Grocery | CompanyFeature.OnlineSales,
        BusinessType.Restaurant => CompanyFeature.Hospitality | CompanyFeature.Events,
        BusinessType.Hotel => CompanyFeature.Hotel | CompanyFeature.Hospitality | CompanyFeature.Events,
        BusinessType.Services => CompanyFeature.Services,
        BusinessType.Pharmacy => CompanyFeature.Pharmacy | CompanyFeature.OnlineSales,
        BusinessType.FuelStation => CompanyFeature.Forecourt | CompanyFeature.Grocery,
        BusinessType.Wholesale => CompanyFeature.Distribution,
        BusinessType.Construction => CompanyFeature.Construction,
        BusinessType.RealEstate => CompanyFeature.RealEstate | CompanyFeature.Rentals,
        BusinessType.AutoParts => CompanyFeature.AutoParts | CompanyFeature.OnlineSales,
        _ => CompanyFeature.All,
    };

    // The modules a new company of this type starts with.
    public static AppModule Modules(BusinessType type) => type switch
    {
        BusinessType.Construction => Office | AppModule.Inventory,
        BusinessType.RealEstate => Office,
        _ => AppModule.All,
    };

    public static string Name(CompanyFeature feature) => char.ToLowerInvariant(feature.ToString()[0]) + feature.ToString()[1..];

    public static List<string> Names(CompanyFeature features) => Selectable.Where(f => features.HasFlag(f)).Select(Name).ToList();

    public static bool TryParse(IEnumerable<string> names, out CompanyFeature features)
    {
        features = CompanyFeature.None;
        foreach (var name in names)
        {
            var match = Selectable.FirstOrDefault(f => string.Equals(Name(f), name, StringComparison.OrdinalIgnoreCase));
            if (match == CompanyFeature.None) return false;
            features |= match;
        }
        return true;
    }
}
