using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Api.Services;
using Pako.Domain.Companies;
using Pako.Domain.Inventory;
using Pako.Domain.Invoicing;
using Pako.Domain.Projects;
using Pako.Domain.Tax;
using Pako.Infrastructure;

namespace Pako.Tests;

// docs/ERP_VERTICALS_PLAN.md phase 1, end to end on real Postgres: a construction site's costs and
// progress bills, a unit sold on installments, a lease's rent run.
public class VerticalsTests : IAsyncLifetime
{
    private static readonly TaxComputationService Tax = new();
    private readonly List<PakoDbContext> _contexts = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var db in _contexts) await db.DisposeAsync();
    }

    private sealed class Co
    {
        public required PakoDbContext Db { get; init; }
        public required Guid Id { get; init; }
        public required Guid UserId { get; init; }
        public required Guid Customer { get; init; }
        public required Guid Vendor { get; init; }
        public required Guid S18 { get; init; }
        public required Guid B18 { get; init; }
        public required Guid Laptop { get; init; }
        public Guid Account(string code) => Db.Accounts.AsNoTracking().Single(a => a.CompanyId == Id && a.Code == code).Id;
    }

    private static T As<T>(T controller, Guid userId) where T : ControllerBase
    {
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, userId.ToString()) }, "TestAuth"))
            }
        };
        return controller;
    }

    private static NullStringLocalizer<ErrorMessages> L => new();

    private async Task<Co> SeedAsync()
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _contexts.Add(db);
        var userId = Guid.NewGuid();
        var created = await As(new CompaniesController(db, L), userId).Create(new CreateCompanyRequest("Ndërtimi Co"));
        var companyId = ((CompanyResponse)Assert.IsAssignableFrom<ObjectResult>(created.Result).Value!).Id;
        var customer = new Partner { Id = Guid.NewGuid(), CompanyId = companyId, Name = "Investitori", IsCustomer = true, FiscalNumber = "811000001" };
        var vendor = new Partner { Id = Guid.NewGuid(), CompanyId = companyId, Name = "Furnitori", IsVendor = true, FiscalNumber = "811000002" };
        db.Partners.AddRange(customer, vendor);
        var laptop = new Item { Id = Guid.NewGuid(), CompanyId = companyId, Code = 1, Name = "Çimento", Unit = "thes", Type = ItemType.Goods, TrackInventory = true };
        db.Items.Add(laptop);
        await db.SaveChangesAsync();
        var taxes = await db.TaxDefinitions.AsNoTracking().Where(t => t.CompanyId == companyId).ToListAsync();
        var c = new Co
        {
            Db = db, Id = companyId, UserId = userId, Customer = customer.Id, Vendor = vendor.Id,
            S18 = taxes.Single(t => t.Code == "S18").Id, B18 = taxes.Single(t => t.Code == "B18").Id, Laptop = laptop.Id,
        };
        // 10 bags in stock at 100 each.
        var bill = (BillResponse)Assert.IsAssignableFrom<ObjectResult>((await Bills(c).Create(companyId, new CreateBillRequest(vendor.Id, "V-1",
            new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 1), new List<CreateBillLineRequest> { new("Çimento", 10m, 118m, c.B18, null, null, laptop.Id) }))).Result).Value!;
        Assert.IsType<OkObjectResult>((await Bills(c).Post(companyId, bill.Id)).Result);
        return c;
    }

    private static BillsController Bills(Co c) => As(new BillsController(c.Db, Tax, L, CompanyAccessContext.Unrestricted()), c.UserId);
    private static InvoicesController Invoices(Co c) =>
        As(new InvoicesController(c.Db, Tax, new DocumentNumberService(), new NumberSeriesService(c.Db), L, CompanyAccessContext.Unrestricted()), c.UserId);
    private static StockService Stock(Co c) => new(c.Db, L);
    private static StockDocumentsController Documents(Co c) =>
        As(new StockDocumentsController(c.Db, new StockDocumentService(c.Db, Stock(c), new NumberSeriesService(c.Db), L, Tax), Stock(c), L), c.UserId);
    private static ConstructionController Construction(Co c) => As(new ConstructionController(c.Db, L, Tax), c.UserId);
    private static RealEstateController RealEstate(Co c) => As(new RealEstateController(c.Db, L), c.UserId);
    private static RentalsController Rentals(Co c) =>
        As(new RentalsController(c.Db, new PriceListService(c.Db, Stock(c), new NumberSeriesService(c.Db), L), L), c.UserId);

    private static T Ok<T>(ActionResult<T> result) where T : class
    {
        var obj = Assert.IsAssignableFrom<ObjectResult>(result.Result);
        Assert.True(obj.Value is T, obj.Value?.ToString());
        return (T)obj.Value!;
    }

    private static async Task<Item> ServiceItemAsync(Co c, string name, decimal? price = null)
    {
        var item = new Item
        {
            Id = Guid.NewGuid(), CompanyId = c.Id, Code = await c.Db.Items.CountAsync(i => i.CompanyId == c.Id) + 1, Name = name, Unit = "copë", Type = ItemType.Service,
            DefaultTaxDefinitionId = c.S18, DefaultUnitPrice = price,
        };
        c.Db.Items.Add(item);
        await c.Db.SaveChangesAsync();
        return item;
    }

    private static async Task<InvoiceResponse> PostInvoiceAsync(Co c, Guid invoiceId)
    {
        var posted = (await Invoices(c).Post(c.Id, invoiceId)).Result;
        Assert.True(posted is OkObjectResult, (posted as ObjectResult)?.Value?.ToString());
        return (InvoiceResponse)((OkObjectResult)posted!).Value!;
    }

    // Materials issued to the site and a subcontractor's bill land on its project and cost codes; a
    // progress bill certifies 40 m² of 100, becomes an invoice tagged with the project, and the
    // percentage of completion compares cost to budget.
    [Fact]
    public async Task Construction_SiteCosts_ProgressBills_AndCompletion()
    {
        var c = await SeedAsync();
        var works = await ServiceItemAsync(c, "Punë ndërtimore");
        var site = Ok(await Construction(c).CreateSite(c.Id, new SaveSiteRequest("Shtëpia Gashi", c.Customer, 2500m, 10m, works.Id,
            new List<CostCodeRequest> { new("MAT", "Materiale", 1000m), new("PUN", "Punë", 500m) },
            new List<BoqLineRequest> { new("A1", "Suvatim", "m²", 100m, 20m), new("A2", "Dyer", "copë", 10m, 50m) }, "KANT-1")));
        Assert.Equal((2500m, "KANT-1"), (site.BoqTotal, site.ProjectCode));
        var mat = site.CostCodes.Single(x => x.Code == "MAT").Id;
        var pun = site.CostCodes.Single(x => x.Code == "PUN").Id;
        // A second site can't take the same project code.
        Assert.IsType<BadRequestObjectResult>((await Construction(c).CreateSite(c.Id, new SaveSiteRequest("Tjetër", c.Customer, 1m, 0m, works.Id,
            new(), new(), "KANT-1"))).Result);

        // Three bags to the site, charged to materials.
        var main = await Stock(c).DefaultWarehouseAsync(c.Id);
        var issue = (StockDocumentResponse)Assert.IsAssignableFrom<ObjectResult>((await Documents(c).Create(c.Id, new SaveStockDocumentRequest(StockDocumentType.SiteIssue,
            new DateOnly(2026, 10, 5), main.Id, new List<StockDocumentLineRequest> { new(c.Laptop, 3m, CostCodeId: mat) }, SiteId: site.Id))).Result).Value!;
        var postedIssue = (StockDocumentResponse)Assert.IsType<OkObjectResult>((await Documents(c).Post(c.Id, issue.Id)).Result).Value!;
        Assert.Equal((300m, $"FDK-0001/2026"), (postedIssue.TotalValue, postedIssue.Number));
        // A subcontractor's work: 236 gross, 200 net, on the project and the labour code.
        var bill = (BillResponse)Assert.IsAssignableFrom<ObjectResult>((await Bills(c).Create(c.Id, new CreateBillRequest(c.Vendor, "SUB-1",
            new DateOnly(2026, 10, 10), new DateOnly(2026, 10, 10), new List<CreateBillLineRequest> { new("Suvatim", 1m, 236m, c.B18, null, CostCodeId: pun) },
            ProjectId: site.ProjectId))).Result).Value!;
        Assert.IsType<OkObjectResult>((await Bills(c).Post(c.Id, bill.Id)).Result);

        // Progress bill 1: 40 m² of plaster.
        var a1 = site.Boq.Single(b => b.Code == "A1").Id;
        var draft = Ok(await Construction(c).CreateProgressBill(c.Id, site.Id, new SaveProgressBillRequest(new DateOnly(2026, 10, 31),
            new List<ProgressBillLineRequest> { new(a1, 40m) })));
        Assert.Equal((800m, 80m, 720m), (draft.Amount, draft.Retention, draft.NetDue));
        Assert.IsType<BadRequestObjectResult>((await Construction(c).Invoice(c.Id, draft.Id)).Result);
        var approved = Ok(await Construction(c).Approve(c.Id, draft.Id));
        Assert.Equal(ProgressBillState.Approved, approved.State);
        var invoiceId = (Guid)Assert.IsType<OkObjectResult>((await Construction(c).Invoice(c.Id, draft.Id)).Result).Value!;
        var invoice = await PostInvoiceAsync(c, invoiceId);
        Assert.Equal(site.ProjectId, invoice.ProjectId);

        // The next bill can't go back below 40.
        Assert.IsType<BadRequestObjectResult>((await Construction(c).CreateProgressBill(c.Id, site.Id, new SaveProgressBillRequest(new DateOnly(2026, 11, 30),
            new List<ProgressBillLineRequest> { new(a1, 30m) }))).Result);

        var progress = Ok(await Construction(c).Progress(c.Id, site.Id));
        Assert.Equal((1500m, 500m, 0.3333m), (progress.BudgetCost, progress.ActualCost, progress.PercentComplete));
        Assert.Equal((833.25m, 800m, -33.25m, 800m, 80m), (progress.EarnedRevenue, progress.Billed, progress.OverUnderBilling, progress.LedgerRevenue, progress.RetentionHeld));
        Assert.Equal((300m, 200m), (progress.CostCodes.Single(r => r.Code == "MAT").Actual, progress.CostCodes.Single(r => r.Code == "PUN").Actual));
        progress = Ok(await Construction(c).ReleaseRetention(c.Id, site.Id, new ReleaseRetentionRequest(80m)));
        Assert.Equal(0m, progress.RetentionHeld);
    }

    // A reserved unit goes only to its holder; the contract's plan is a down payment and three
    // equal installments; two are invoiced together and posted on the building's project.
    [Fact]
    public async Task RealEstate_ReserveSell_AndInvoiceInstallments()
    {
        var c = await SeedAsync();
        var sale = await ServiceItemAsync(c, "Shitje banese");
        var building = Ok(await RealEstate(c).CreateBuilding(c.Id, new SaveBuildingRequest("Kulla A", sale.Id, "KA", "Prishtinë")));
        var unit = Ok(await RealEstate(c).CreateUnit(c.Id, new SaveUnitRequest(building.Id, "A-1", UnitKind.Apartment, 85m, 85000m, "1")));
        Assert.Equal(1000m, unit.PricePerSquareMetre);
        var other = new Partner { Id = Guid.NewGuid(), CompanyId = c.Id, Name = "Blerësi tjetër", IsCustomer = true, FiscalNumber = "811000009" };
        c.Db.Partners.Add(other);
        await c.Db.SaveChangesAsync();

        var today = DateOnly.FromDateTime(PosService.LocalTime(DateTime.UtcNow));
        Ok(await RealEstate(c).Reserve(c.Id, new SaveReservationRequest(unit.Id, c.Customer, today, today.AddDays(14), 2000m)));
        Assert.IsType<BadRequestObjectResult>((await RealEstate(c).CreateContract(c.Id, new SaveSaleContractRequest(unit.Id, other.Id, today, 85000m))).Result);
        // The plan must add up to the price.
        Assert.IsType<BadRequestObjectResult>((await RealEstate(c).CreateContract(c.Id, new SaveSaleContractRequest(unit.Id, c.Customer, today, 85000m,
            Installments: new List<InstallmentRequest> { new(today, 80000m) }))).Result);
        var contract = Ok(await RealEstate(c).CreateContract(c.Id, new SaveSaleContractRequest(unit.Id, c.Customer, today, 85000m,
            DownPayment: 25000m, InstallmentCount: 3)));
        Assert.Equal(new[] { 25000m, 20000m, 20000m, 20000m }, contract.Installments.Select(i => i.Amount).ToArray());
        var units = Ok(await RealEstate(c).Units(c.Id, building.Id));
        Assert.Equal((UnitState.Sold, "Investitori"), (units[0].State, units[0].HolderName));

        var invoiceId = (Guid)Assert.IsType<OkObjectResult>((await RealEstate(c).InvoiceInstallments(c.Id, contract.Id,
            new InvoiceInstallmentsRequest(contract.Installments.Take(2).Select(i => i.Id).ToList()))).Result).Value!;
        // The same installment can't be invoiced twice.
        Assert.IsType<BadRequestObjectResult>((await RealEstate(c).InvoiceInstallments(c.Id, contract.Id,
            new InvoiceInstallmentsRequest(new List<Guid> { contract.Installments[0].Id }))).Result);
        var invoice = await PostInvoiceAsync(c, invoiceId);
        Assert.Equal(2, invoice.Lines.Count);
        Assert.Equal(building.ProjectId, invoice.ProjectId);
        contract = Ok(await RealEstate(c).Contract(c.Id, contract.Id));
        Assert.Equal((45000m, 0m, 85000m), (contract.Invoiced, contract.Paid, contract.Outstanding));
        // Invoiced: it can't be cancelled any more.
        Assert.IsType<BadRequestObjectResult>((await RealEstate(c).CancelContract(c.Id, contract.Id)).Result);
    }

    // A lease from the 16th of a 30-day month is charged half the rent, plus the electricity read
    // since it started; the month is never invoiced twice; the last month runs to the end date.
    [Fact]
    public async Task Rentals_RentRun_ProratesAndRebillsMeters()
    {
        var c = await SeedAsync();
        var rent = await ServiceItemAsync(c, "Qira");
        var power = await ServiceItemAsync(c, "Energji elektrike", 0.10m);
        var sale = await ServiceItemAsync(c, "Shitje");
        var building = Ok(await RealEstate(c).CreateBuilding(c.Id, new SaveBuildingRequest("Kulla B", sale.Id, "KB")));
        var unit = Ok(await RealEstate(c).CreateUnit(c.Id, new SaveUnitRequest(building.Id, "L-1", UnitKind.Commercial, 40m, 0m)));

        var lease = Ok(await Rentals(c).CreateLease(c.Id, new SaveLeaseRequest(c.Customer, new DateOnly(2026, 11, 16), 300m, rent.Id, unit.Id, DueDay: 5,
            Deposit: 600m, Meters: new List<LeaseMeterRequest> { new("Rryma", power.Id, 1000m) })));
        Assert.Equal((LeaseState.Draft, "QR-0001"), (lease.State, lease.Number));
        lease = Ok(await Rentals(c).Activate(c.Id, lease.Id));
        Assert.Equal(UnitState.Rented, Ok(await RealEstate(c).Units(c.Id, building.Id))[0].State);
        Assert.IsType<BadRequestObjectResult>((await Rentals(c).Read(c.Id, lease.Id, lease.Meters[0].Id, new MeterReadingInput(900m))).Result);
        Ok(await Rentals(c).Read(c.Id, lease.Id, lease.Meters[0].Id, new MeterReadingInput(1100m)));

        // October: not running yet. November: 15 of 30 days, and 100 kWh at 0.10.
        Assert.Equal((0, 1), (Ok(await Rentals(c).Run(c.Id, new RentRunRequest(new DateOnly(2026, 10, 1)))).Created,
            Ok(await Rentals(c).Run(c.Id, new RentRunRequest(new DateOnly(2026, 10, 1)))).NotRunning));
        var november = Ok(await Rentals(c).Run(c.Id, new RentRunRequest(new DateOnly(2026, 11, 20))));
        var invoiceId = Assert.Single(november.InvoiceIds);
        var draft = await c.Db.Invoices.AsNoTracking().Include(i => i.Lines).SingleAsync(i => i.Id == invoiceId);
        var rentLine = draft.Lines.Single(l => l.ItemId == rent.Id);
        var powerLine = draft.Lines.Single(l => l.ItemId == power.Id);
        Assert.Equal((150m, 100m, 0.10m), (rentLine.UnitPrice, powerLine.Quantity, powerLine.UnitPrice));
        Assert.Equal(new DateOnly(2026, 11, 5), draft.DueDate);
        Assert.Equal((0, 1), (Ok(await Rentals(c).Run(c.Id, new RentRunRequest(new DateOnly(2026, 11, 1)))).Created,
            Ok(await Rentals(c).Run(c.Id, new RentRunRequest(new DateOnly(2026, 11, 1)))).AlreadyInvoiced));
        await PostInvoiceAsync(c, invoiceId);
        lease = Ok(await Rentals(c).Lease(c.Id, lease.Id));
        Assert.Equal((160m, new DateOnly(2026, 11, 1), 1100m), (lease.Arrears, lease.LastInvoicedPeriod!.Value, lease.Meters[0].LastReading));

        // The tenant leaves on 10 December: 10 of 31 days.
        Ok(await Rentals(c).End(c.Id, lease.Id, new EndLeaseRequest(new DateOnly(2026, 12, 10))));
        Assert.Equal(UnitState.Available, Ok(await RealEstate(c).Units(c.Id, building.Id))[0].State);
        var december = Ok(await Rentals(c).Run(c.Id, new RentRunRequest(new DateOnly(2026, 12, 1))));
        var last = await c.Db.Invoices.AsNoTracking().Include(i => i.Lines).SingleAsync(i => i.Id == december.InvoiceIds[0]);
        Assert.Equal(96.77m, Assert.Single(last.Lines).UnitPrice);
    }
}
