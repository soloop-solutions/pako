using System.Security.Claims;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
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
using Pako.Domain.Ledger;
using Pako.Domain.Pos;
using Pako.Domain.Tax;
using Pako.Fiscal.Xk;
using Pako.Infrastructure;
using BillDocumentType = Pako.Domain.Bills.DocumentType;

namespace Pako.Tests;

// docs/POS_PLAN.md P1 on real Postgres through the real controller: a till sells, returns and
// closes its session into one journal entry, with fiscal coupons in training and SEF modes.
public class PosTests : IAsyncLifetime
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
        public required Guid Laptop { get; init; }
        public required Guid Customer { get; init; }
        public required Guid S18 { get; init; }
        public required Guid Cash { get; init; }
        public required Guid Card { get; init; }
        public required Guid Warehouse { get; init; }
        public Guid Account(string code) => Db.Accounts.AsNoTracking().Single(a => a.CompanyId == Id && a.Code == code).Id;
    }

    private static T As<T>(T controller, Guid userId) where T : ControllerBase
    {
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(new[]
                {
                    new Claim(ClaimTypes.NameIdentifier, userId.ToString()), new Claim(ClaimTypes.Email, "arta@pako.test"),
                }, "TestAuth"))
            }
        };
        return controller;
    }

    private async Task<Co> SeedAsync()
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _contexts.Add(db);
        var userId = Guid.NewGuid();
        var created = await As(new CompaniesController(db, new NullStringLocalizer<ErrorMessages>()), userId).Create(new CreateCompanyRequest("Market Co"));
        var companyId = ((CompanyResponse)Assert.IsAssignableFrom<ObjectResult>(created.Result).Value!).Id;
        var company = await db.Companies.SingleAsync(c => c.Id == companyId);
        company.FiscalNumber = "811234567";

        var laptop = new Item { Id = Guid.NewGuid(), CompanyId = companyId, Code = 1, Name = "Laptop", Unit = "copë", Type = ItemType.Goods, TrackInventory = true };
        var customer = new Partner { Id = Guid.NewGuid(), CompanyId = companyId, Name = "Arben", IsCustomer = true, FiscalNumber = "1234567890" };
        db.Items.Add(laptop);
        db.Partners.Add(customer);
        await db.SaveChangesAsync();
        var s18 = (await db.TaxDefinitions.AsNoTracking().SingleAsync(t => t.CompanyId == companyId && t.Code == "S18")).Id;
        laptop.DefaultTaxDefinitionId = s18;
        await db.SaveChangesAsync();
        var methods = await db.PaymentMethods.AsNoTracking().Where(m => m.CompanyId == companyId).ToListAsync();
        var stock = new StockService(db, new NullStringLocalizer<ErrorMessages>());
        var warehouse = await stock.DefaultWarehouseAsync(companyId);
        await db.SaveChangesAsync();

        // 10 laptops in stock at 100 each (a bill: 118 gross, B18).
        var b18 = (await db.TaxDefinitions.AsNoTracking().SingleAsync(t => t.CompanyId == companyId && t.Code == "B18")).Id;
        var vendor = new Partner { Id = Guid.NewGuid(), CompanyId = companyId, Name = "Vendor", IsVendor = true, FiscalNumber = "811000002" };
        db.Partners.Add(vendor);
        await db.SaveChangesAsync();
        var bills = As(new BillsController(db, Tax, new NullStringLocalizer<ErrorMessages>(), CompanyAccessContext.Unrestricted()), userId);
        var bill = (BillResponse)Assert.IsAssignableFrom<ObjectResult>((await bills.Create(companyId, new CreateBillRequest(vendor.Id, "V-1",
            new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 1),
            new List<CreateBillLineRequest> { new("Laptops", 10m, 118m, b18, null, null, laptop.Id) }))).Result).Value!;
        Assert.IsType<OkObjectResult>((await bills.Post(companyId, bill.Id)).Result);

        return new Co
        {
            Db = db, Id = companyId, UserId = userId, Laptop = laptop.Id, Customer = customer.Id, S18 = s18,
            Cash = methods.Single(m => m.Kind == PaymentMethodKind.Cash).Id, Card = methods.Single(m => m.Kind == PaymentMethodKind.Card).Id,
            Warehouse = warehouse.Id,
        };
    }

    private static PosController Pos(Co c) =>
        As(new PosController(c.Db, new PosService(c.Db, new StockService(c.Db, new NullStringLocalizer<ErrorMessages>()), new NullStringLocalizer<ErrorMessages>()),
            new PriceListService(c.Db, new StockService(c.Db, new NullStringLocalizer<ErrorMessages>()), new NumberSeriesService(c.Db), new NullStringLocalizer<ErrorMessages>()),
            new NullStringLocalizer<ErrorMessages>(), CompanyAccessContext.Unrestricted(), Operators(c)), c.UserId);

    // One key for the whole test run, so a token one controller issues another can read.
    private static readonly Microsoft.AspNetCore.DataProtection.IDataProtectionProvider Protection =
        new Microsoft.AspNetCore.DataProtection.EphemeralDataProtectionProvider();

    private static PosOperatorService Operators(Co c) => new(c.Db, Protection, new NullStringLocalizer<ErrorMessages>());

    private static async Task<(StoreResponse Store, RegisterResponse Register)> SetupAsync(Co c, FiscalMode mode = FiscalMode.Training)
    {
        var store = (StoreResponse)Assert.IsAssignableFrom<ObjectResult>((await Pos(c).CreateStore(c.Id,
            new SaveStoreRequest("PR1", "Prishtina 1", "Rr. Agim Ramadani", 1, "Prishtinë", c.Warehouse))).Result).Value!;
        var register = (RegisterResponse)Assert.IsAssignableFrom<ObjectResult>((await Pos(c).CreateRegister(c.Id,
            new SaveRegisterRequest(store.Id, "K1", "Arka 1", RegisterProfile.Retail, mode, 1, c.Account("100100")))).Result).Value!;
        return (store, register);
    }

    private static async Task<SessionSummaryResponse> OpenAsync(Co c, Guid registerId, decimal openingFloat = 50m) =>
        (SessionSummaryResponse)Assert.IsAssignableFrom<ObjectResult>((await Pos(c).OpenSession(c.Id, registerId, new OpenSessionRequest(openingFloat))).Result).Value!;

    private static PosOrderRequest Sale(Co c, Guid sessionId, decimal quantity, List<PosPaymentRequest> payments, Guid? clientUuid = null,
        decimal unitPrice = 236m, PosFiscalRequest? fiscal = null) =>
        new(clientUuid ?? Guid.NewGuid(), sessionId, PosOrderKind.Sale, new DateTime(2026, 10, 31, 10, 0, 0, DateTimeKind.Utc),
            new List<PosOrderLineRequest> { new(c.Laptop, "Laptop", quantity, unitPrice, null) }, payments, Fiscal: fiscal);

    private static async Task<IActionResult?> Submit(Co c, PosOrderRequest request)
    {
        var result = await Pos(c).SubmitOrder(c.Id, request);
        return result.Result;
    }

    [Fact]
    public async Task Till_Sells_Returns_AndClosesTheSession_IntoOneBalancedEntry()
    {
        var c = await SeedAsync();
        var (_, register) = await SetupAsync(c);
        var session = await OpenAsync(c, register.Id, openingFloat: 150m);
        // A second session on the same register is refused.
        Assert.IsType<BadRequestObjectResult>((await Pos(c).OpenSession(c.Id, register.Id, new OpenSessionRequest(0))).Result);

        // 2 laptops at 236: 172 cash (200 handed over) + 300 card.
        var uuid = Guid.NewGuid();
        var sale = (PosOrderResponse)Assert.IsAssignableFrom<ObjectResult>(await Submit(c, Sale(c, session.Id, 2m,
            new List<PosPaymentRequest> { new(c.Cash, 172m, 200m), new(c.Card, 300m) }, uuid))!).Value!;
        Assert.Equal((472m, 72m, 28m), (sale.Total, sale.TotalTax, sale.Change));
        Assert.Equal(FiscalDocumentType.Training, sale.Fiscal!.Type);
        Assert.Equal(AtkStatus.NotSent, sale.Fiscal.AtkStatus);
        Assert.Equal(PosService.CouponIdFor(1, 1, 1), sale.Fiscal.CouponId);
        Assert.Contains("|", sale.Fiscal.QrCode);

        // The till resends the same order (lost answer): recorded once.
        Assert.IsType<OkObjectResult>(await Submit(c, Sale(c, session.Id, 2m, new List<PosPaymentRequest> { new(c.Cash, 172m, 200m), new(c.Card, 300m) }, uuid)));
        Assert.Equal(1, await c.Db.PosOrders.CountAsync(o => o.CompanyId == c.Id));

        // Payments must cover the total exactly; cash above €2,000 from an individual is refused.
        Assert.IsType<BadRequestObjectResult>(await Submit(c, Sale(c, session.Id, 1m, new List<PosPaymentRequest> { new(c.Cash, 200m) })));
        Assert.IsType<BadRequestObjectResult>(await Submit(c, Sale(c, session.Id, 9m, new List<PosPaymentRequest> { new(c.Cash, 2124m) })));

        // One laptop comes back, refunded in cash, at the price and cost it was sold at.
        var original = await c.Db.PosOrders.AsNoTracking().Include(o => o.Lines).SingleAsync(o => o.ClientUuid == uuid);
        var ret = (PosOrderResponse)Assert.IsAssignableFrom<ObjectResult>(await Submit(c, new PosOrderRequest(Guid.NewGuid(), session.Id, PosOrderKind.Return,
            new DateTime(2026, 10, 31, 11, 0, 0, DateTimeKind.Utc), new List<PosOrderLineRequest> { new(c.Laptop, "Laptop", 1m, 999m, null, OriginalLineId: original.Lines[0].Id) },
            new List<PosPaymentRequest> { new(c.Cash, 236m) }, OriginalOrderId: original.Id, Reason: "Defekt"))!).Value!;
        Assert.Equal((236m, FiscalDocumentType.Training), (ret.Total, ret.Fiscal!.Type));
        Assert.Equal(sale.Fiscal.CouponId, ret.Fiscal.ReferenceCouponId);
        // More than what's left can't be returned.
        Assert.IsType<BadRequestObjectResult>(await Submit(c, new PosOrderRequest(Guid.NewGuid(), session.Id, PosOrderKind.Return, DateTime.UtcNow,
            new List<PosOrderLineRequest> { new(c.Laptop, "Laptop", 2m, 236m, null, OriginalLineId: original.Lines[0].Id) },
            new List<PosPaymentRequest> { new(c.Cash, 472m) }, OriginalOrderId: original.Id, Reason: "x")));

        // 20 paid out to a supplier from the drawer.
        var expense = c.Account("660300");
        Assert.IsAssignableFrom<ObjectResult>((await Pos(c).AddCashMovement(c.Id, session.Id,
            new CashMovementRequest(PosCashMovementKind.PaidOut, 20m, "Pastrim", expense))).Result);

        var x = (SessionReportResponse)Assert.IsType<OkObjectResult>((await Pos(c).SessionReport(c.Id, session.Id)).Result).Value!;
        // Cash: 150 float + 172 − 236 refund − 20 paid out = 66.
        Assert.Equal((66m, 1, 1, 236m), (x.CashExpected, x.Sales, x.Returns, x.NetSales));

        // A difference needs a reason; then the close posts one entry.
        Assert.IsType<BadRequestObjectResult>((await Pos(c).CloseSession(c.Id, session.Id,
            new CloseSessionRequest(new List<CountedTenderRequest> { new(c.Cash, 65m) }))).Result);
        var closed = (await Pos(c).CloseSession(c.Id, session.Id,
            new CloseSessionRequest(new List<CountedTenderRequest> { new(c.Cash, 65m, "1 € short") }))).Result;
        Assert.True(closed is OkObjectResult, (closed as BadRequestObjectResult)?.Value?.ToString());
        var z = (SessionReportResponse)((OkObjectResult)closed!).Value!;
        Assert.Equal(PosSessionState.Posted, z.State);
        Assert.NotNull(z.JournalEntryId);

        var lines = await c.Db.JournalEntryLines.AsNoTracking().Where(l => l.JournalEntryId == z.JournalEntryId).ToListAsync();
        Assert.Equal(lines.Sum(l => l.Debit), lines.Sum(l => l.Credit));
        decimal Net(string code) => lines.Where(l => l.AccountId == c.Account(code)).Sum(l => l.Debit - l.Credit);
        // Net sale of 1 laptop: 200 revenue, 36 VAT (tax-coded), card 300 in clearing, cash.
        Assert.Equal(-200m, Net("400100"));
        Assert.Equal(-36m, Net("210110"));
        Assert.All(lines.Where(l => l.AccountId == c.Account("210110") || l.AccountId == c.Account("400100")), l => Assert.Equal(c.S18, l.TaxId));
        Assert.Equal(300m, Net("103200"));
        // Drawer (the float was already there): +172 sale − 236 refund − 20 paid out − 1 short.
        Assert.Equal(-85m, Net("100100"));
        Assert.Equal(1m, Net("100900"));
        Assert.Equal(20m, Net("660300"));
        // Cost of the one laptop that left: 100.
        Assert.Equal(100m, Net("500100"));
        Assert.Equal(9m, (await c.Db.ItemCosts.AsNoTracking().SingleAsync(k => k.ItemId == c.Laptop)).Quantity);
        // A closed session takes no new sales.
        Assert.IsType<BadRequestObjectResult>(await Submit(c, Sale(c, session.Id, 1m, new List<PosPaymentRequest> { new(c.Cash, 236m) })));
    }

    // ---- SEF: the till signs, the server checks ----

    private static (ECDsa Key, string CertificatePem) TillCertificate(ulong businessId)
    {
        var key = FiscalPki.GenerateKey();
        var request = new CertificateRequest($"C=RKS, O={businessId}, OU=1, L=1, CN=Market Co", key, HashAlgorithmName.SHA256);
        // Valid on the coupons' date (31 Oct 2026), whatever day the test runs.
        using var cert = request.CreateSelfSigned(new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero), new DateTimeOffset(2036, 1, 1, 0, 0, 0, TimeSpan.Zero));
        return (key, cert.ExportCertificatePem());
    }

    private static PosFiscalRequest SignedCoupon(ECDsa key, long couponId, decimal quantity, decimal total, decimal unitPrice = 236m)
    {
        var request = new FiscalCouponRequest(new FiscalIssuer(811234567, 1, 1, ApplicationId: 77, "Prishtinë"), (ulong)couponId, FiscalCouponType.Sale,
            new DateTimeOffset(2026, 10, 31, 10, 0, 0, TimeSpan.Zero), "arta", "VER0000000000001",
            new[] { new FiscalCouponLine("Laptop", "copë", quantity, unitPrice, total, TaxLetters.Standard) },
            new[] { new FiscalCouponPayment(FiscalPaymentType.Cash, total) });
        var built = CouponBuilder.Build(request);
        using var signer = new CouponSigner(key);
        var signed = signer.SignPosCoupon(built.Pos);
        return new PosFiscalRequest(couponId, "VER0000000000001", new DateTime(2026, 10, 31, 10, 0, 0, DateTimeKind.Utc), signed.Details, signed.Signature,
            signer.QrCode(built.Citizen), DailyNumber: 1);
    }

    [Fact]
    public async Task SefRegister_AcceptsCouponsItsTillSigned_AndRefusesAnythingElse()
    {
        var c = await SeedAsync();
        var (_, register) = await SetupAsync(c, FiscalMode.Sef);
        var session = await OpenAsync(c, register.Id);
        var (key, certificate) = TillCertificate(811234567);
        using (key)
        {
            // Not onboarded yet: no certificate, no fiscal sales.
            Assert.IsType<BadRequestObjectResult>(await Submit(c, Sale(c, session.Id, 1m, new List<PosPaymentRequest> { new(c.Cash, 236m) },
                fiscal: SignedCoupon(key, 1, 1m, 236m))));
            // The private key is never accepted; the certificate is.
            Assert.IsType<BadRequestObjectResult>((await Pos(c).SaveCertificate(c.Id, register.Id, new SaveRegisterCertificateRequest(key.ExportPkcs8PrivateKeyPem()))).Result);
            Assert.IsType<OkObjectResult>((await Pos(c).SaveCertificate(c.Id, register.Id, new SaveRegisterCertificateRequest(certificate))).Result);

            var couponId = PosService.CouponIdFor(1, 1, 1);
            var sale = (PosOrderResponse)Assert.IsAssignableFrom<ObjectResult>(await Submit(c, Sale(c, session.Id, 1m,
                new List<PosPaymentRequest> { new(c.Cash, 236m) }, fiscal: SignedCoupon(key, couponId, 1m, 236m)))!).Value!;
            Assert.Equal((FiscalDocumentType.Sale, AtkStatus.Pending, couponId), (sale.Fiscal!.Type, sale.Fiscal.AtkStatus, sale.Fiscal.CouponId));
            Assert.Equal(sale.Fiscal.IssuedAt + PosService.OfflineDeadline, sale.Fiscal.SendBy);

            // A coupon that says something else than the order (2 laptops signed, 1 sold) is refused.
            Assert.IsType<BadRequestObjectResult>(await Submit(c, Sale(c, session.Id, 1m, new List<PosPaymentRequest> { new(c.Cash, 236m) },
                fiscal: SignedCoupon(key, couponId + 1, 2m, 472m))));
            // So is one signed with another key.
            using var other = FiscalPki.GenerateKey();
            Assert.IsType<BadRequestObjectResult>(await Submit(c, Sale(c, session.Id, 1m, new List<PosPaymentRequest> { new(c.Cash, 236m) },
                fiscal: SignedCoupon(other, couponId + 2, 1m, 236m))));
        }
    }

    [Fact]
    public async Task Quote_PricesTheBasket_AndAReturnAsItWasSold()
    {
        var c = await SeedAsync();
        var (_, register) = await SetupAsync(c);
        var session = await OpenAsync(c, register.Id);
        var basket = new List<PosOrderLineRequest> { new(c.Laptop, "Laptop", 3m, 236m, null, DiscountAmount: 10m) };

        // 3 × 236 less 10 = 698; 700 handed over in cash gives 2 back.
        var quote = (PosQuoteResponse)Assert.IsType<OkObjectResult>((await Pos(c).Quote(c.Id, register.Id,
            new PosQuoteRequest(basket, new List<PosPaymentRequest> { new(c.Cash, 698m, 700m) }))).Result).Value!;
        Assert.Equal((698m, 106.47m, 10m, 0m, 2m, false), (quote.Total, quote.TotalTax, quote.TotalDiscount, quote.Remaining, quote.Change, quote.CashLimitExceeded));
        Assert.Equal("E", Assert.Single(quote.Taxes).TaxLetter);

        var sale = (PosOrderResponse)Assert.IsAssignableFrom<ObjectResult>(await Submit(c, new PosOrderRequest(Guid.NewGuid(), session.Id,
            PosOrderKind.Sale, DateTime.UtcNow, basket, new List<PosPaymentRequest> { new(c.Cash, 698m, 700m) }))!).Value!;
        Assert.Equal((698m, 2m), (sale.Total, sale.Change));
        var tax = Assert.Single(sale.Taxes);
        Assert.Equal(("E", 698m, 591.53m, 106.47m), (tax.TaxLetter, tax.Gross, tax.Net, tax.Tax));

        // One of the three back: its share of the discount (3.33) comes off the refund.
        var back = (PosQuoteResponse)Assert.IsType<OkObjectResult>((await Pos(c).Quote(c.Id, register.Id, new PosQuoteRequest(
            new List<PosOrderLineRequest> { new(c.Laptop, "Laptop", 1m, 0m, null, OriginalLineId: sale.Lines[0].Id) }, OriginalOrderId: sale.Id))).Result).Value!;
        Assert.Equal(232.67m, back.Total);

        // Cancelling the whole coupon: no lines sent, the server takes them all back.
        var cancel = (PosOrderResponse)Assert.IsAssignableFrom<ObjectResult>(await Submit(c, new PosOrderRequest(Guid.NewGuid(), session.Id,
            PosOrderKind.Cancel, DateTime.UtcNow, new List<PosOrderLineRequest>(), new List<PosPaymentRequest> { new(c.Cash, 698m) },
            OriginalOrderId: sale.Id, Reason: "Gabim"))!).Value!;
        Assert.Equal((698m, PosOrderKind.Cancel, sale.Fiscal!.CouponId), (cancel.Total, cancel.Kind, cancel.Fiscal!.ReferenceCouponId!.Value));
        Assert.Equal(PosOrderState.Cancelled, (await c.Db.PosOrders.AsNoTracking().SingleAsync(o => o.Id == sale.Id)).State);
    }

    [Fact]
    public async Task Order_RefusesDoubleReturnLines_PurchaseVat_OversizedDiscounts_AndDuplicateCounts()
    {
        var c = await SeedAsync();
        var (_, register) = await SetupAsync(c);
        var session = await OpenAsync(c, register.Id);
        var sale = (PosOrderResponse)Assert.IsAssignableFrom<ObjectResult>(await Submit(c, Sale(c, session.Id, 1m,
            new List<PosPaymentRequest> { new(c.Cash, 236m) }))!).Value!;

        // The one laptop listed twice in one return would give back two.
        var twice = new List<PosOrderLineRequest>
        {
            new(c.Laptop, "Laptop", 1m, 236m, null, OriginalLineId: sale.Lines[0].Id),
            new(c.Laptop, "Laptop", 1m, 236m, null, OriginalLineId: sale.Lines[0].Id),
        };
        Assert.IsType<BadRequestObjectResult>(await Submit(c, new PosOrderRequest(Guid.NewGuid(), session.Id, PosOrderKind.Return, DateTime.UtcNow,
            twice, new List<PosPaymentRequest> { new(c.Cash, 472m) }, OriginalOrderId: sale.Id, Reason: "x")));

        // A purchase VAT code (B18) would post sales VAT as deductible input VAT.
        var b18 = (await c.Db.TaxDefinitions.AsNoTracking().SingleAsync(t => t.CompanyId == c.Id && t.Code == "B18")).Id;
        Assert.IsType<BadRequestObjectResult>(await Submit(c, new PosOrderRequest(Guid.NewGuid(), session.Id, PosOrderKind.Sale, DateTime.UtcNow,
            new List<PosOrderLineRequest> { new(c.Laptop, "Laptop", 1m, 236m, b18) }, new List<PosPaymentRequest> { new(c.Cash, 236m) })));

        // A discount larger than the line is a clear refusal, in the quote and the order alike.
        var oversized = new List<PosOrderLineRequest> { new(c.Laptop, "Laptop", 1m, 236m, null, DiscountAmount: 300m) };
        Assert.IsType<BadRequestObjectResult>((await Pos(c).Quote(c.Id, register.Id, new PosQuoteRequest(oversized))).Result);
        Assert.IsType<BadRequestObjectResult>(await Submit(c, new PosOrderRequest(Guid.NewGuid(), session.Id, PosOrderKind.Sale, DateTime.UtcNow,
            oversized, new List<PosPaymentRequest> { new(c.Cash, 1m) })));

        // The same tender counted twice at the close.
        Assert.IsType<BadRequestObjectResult>((await Pos(c).CloseSession(c.Id, session.Id, new CloseSessionRequest(
            new List<CountedTenderRequest> { new(c.Cash, 286m), new(c.Cash, 286m) }))).Result);
    }

    [Fact]
    public async Task BackDatedBill_DuringAnOpenSession_DoesNotCountTheCostTwice()
    {
        var c = await SeedAsync();
        var (_, register) = await SetupAsync(c);
        var session = await OpenAsync(c, register.Id);
        // One laptop sold on 31 Oct at the average of 100.
        Assert.IsAssignableFrom<ObjectResult>(await Submit(c, Sale(c, session.Id, 1m, new List<PosPaymentRequest> { new(c.Cash, 236m) })));

        // A bill dated 15 Oct (10 at 200 net) arrives while the session is open: the average on the
        // sale's date becomes 150, and the bill books the +50 the sale's cost changed by.
        var vendor = await c.Db.Partners.AsNoTracking().FirstAsync(p => p.CompanyId == c.Id && p.IsVendor);
        var b18 = (await c.Db.TaxDefinitions.AsNoTracking().SingleAsync(t => t.CompanyId == c.Id && t.Code == "B18")).Id;
        var bills = As(new BillsController(c.Db, Tax, new NullStringLocalizer<ErrorMessages>(), CompanyAccessContext.Unrestricted()), c.UserId);
        var bill = (BillResponse)Assert.IsAssignableFrom<ObjectResult>((await bills.Create(c.Id, new CreateBillRequest(vendor.Id, "V-2",
            new DateOnly(2026, 10, 15), new DateOnly(2026, 10, 15),
            new List<CreateBillLineRequest> { new("Laptops", 10m, 236m, b18, null, null, c.Laptop) }))).Result).Value!;
        Assert.IsType<OkObjectResult>((await bills.Post(c.Id, bill.Id)).Result);

        var closed = (await Pos(c).CloseSession(c.Id, session.Id, new CloseSessionRequest(new List<CountedTenderRequest>()))).Result;
        Assert.True(closed is OkObjectResult, (closed as BadRequestObjectResult)?.Value?.ToString());

        // Cost of goods sold over all the company's entries: the laptop at 150, once.
        var cogs = c.Account("500100");
        var booked = await c.Db.JournalEntryLines.AsNoTracking()
            .Where(l => l.AccountId == cogs && c.Db.JournalEntries.Any(e => e.Id == l.JournalEntryId && e.CompanyId == c.Id))
            .SumAsync(l => l.Debit - l.Credit);
        Assert.Equal(150m, booked);
    }

    // ---- P2: grocery ----

    private static string Ean13(string twelve)
    {
        var sum = twelve.Select((ch, i) => (ch - '0') * (i % 2 == 0 ? 1 : 3)).Sum();
        return twelve + (10 - sum % 10) % 10;
    }

    [Fact]
    public async Task Scan_FindsBarcodes_Codes_Plus_AndScaleLabels()
    {
        var c = await SeedAsync();
        var (_, register) = await SetupAsync(c);
        var cheese = new Item { Id = Guid.NewGuid(), CompanyId = c.Id, Code = 7, Name = "Djathë", Unit = "kg", Type = ItemType.Goods,
            Plu = "123", SellByWeight = true, DefaultUnitPrice = 8.5m, DefaultTaxDefinitionId = c.S18 };
        c.Db.Items.Add(cheese);
        c.Db.ItemBarcodes.Add(new ItemBarcode { Id = Guid.NewGuid(), ItemId = c.Laptop, Barcode = "3830001234567" });
        await c.Db.SaveChangesAsync();

        async Task<PosScanResponse?> Scan(string code) =>
            (await Pos(c).Scan(c.Id, register.Id, code)).Result is OkObjectResult ok ? (PosScanResponse)ok.Value! : null;

        Assert.Equal((c.Laptop, "barcode"), ((await Scan("3830001234567"))!.Item.Id, (await Scan("3830001234567"))!.Match));
        Assert.Equal("code", (await Scan("7"))!.Match);
        Assert.Equal((cheese.Id, "plu"), ((await Scan("00123"))!.Item.Id, (await Scan("00123"))!.Match));
        // Default rules: 21 = weight in kg (3 decimals), 22 = price in € (2 decimals); PLU padded to 5.
        var weighed = (await Scan(Ean13("210012301250")))!;
        Assert.Equal((cheese.Id, "weight", 1.25m, (decimal?)null), (weighed.Item.Id, weighed.Match, weighed.Quantity!.Value, weighed.UnitPrice));
        var priced = (await Scan(Ean13("220012300999")))!;
        Assert.Equal(("price", 1m, 9.99m), (priced.Match, priced.Quantity!.Value, priced.UnitPrice!.Value));
        // A wrong check digit or an unknown PLU finds nothing.
        var valid = Ean13("210012301250");
        Assert.Null(await Scan(valid[..12] + (char)('0' + (valid[12] - '0' + 1) % 10)));
        Assert.Null(await Scan(Ean13("210099901250")));

        // A company's own rule replaces the defaults: 25 = quantity.
        Assert.IsAssignableFrom<ObjectResult>((await Pos(c).CreateBarcodeRule(c.Id,
            new SaveBarcodeRuleRequest("25", BarcodeRuleKind.Quantity, 5, 5, 0))).Result);
        Assert.Equal(("quantity", 12m), ((await Scan(Ean13("250012300012")))!.Match, (await Scan(Ean13("250012300012")))!.Quantity!.Value));
        Assert.Null(await Scan(Ean13("210012301250")));
        Assert.IsType<BadRequestObjectResult>((await Pos(c).CreateBarcodeRule(c.Id, new SaveBarcodeRuleRequest("31", BarcodeRuleKind.Weight))).Result);
    }

    [Fact]
    public async Task AgeRestrictedItems_NeedTheCashiersConfirmation()
    {
        var c = await SeedAsync();
        var laptop = await c.Db.Items.SingleAsync(i => i.Id == c.Laptop);
        laptop.MinimumAge = 18;
        await c.Db.SaveChangesAsync();
        var (_, register) = await SetupAsync(c);
        var session = await OpenAsync(c, register.Id);
        Assert.IsType<BadRequestObjectResult>(await Submit(c, Sale(c, session.Id, 1m, new List<PosPaymentRequest> { new(c.Cash, 236m) })));
        var confirmed = new PosOrderRequest(Guid.NewGuid(), session.Id, PosOrderKind.Sale, DateTime.UtcNow,
            new List<PosOrderLineRequest> { new(c.Laptop, "Laptop", 1m, 236m, null, AgeVerified: true) }, new List<PosPaymentRequest> { new(c.Cash, 236m) });
        Assert.IsAssignableFrom<ObjectResult>(await Submit(c, confirmed));
        Assert.True(await c.Db.PosOrderLines.AnyAsync(l => l.ItemId == c.Laptop && l.AgeVerified));
    }

    private static PosProgramsController Programs(Co c) =>
        As(new PosProgramsController(c.Db, new NullStringLocalizer<ErrorMessages>()), c.UserId);

    // P2: promotions and coupons price the basket on the server; loyalty earns and redeems; gift
    // cards load and spend a liability; a refund can go to store credit.
    [Fact]
    public async Task Programs_LoyaltyAndGiftCards_PriceAndPayTheBasket()
    {
        var c = await SeedAsync();
        var advances = c.Account("240300");
        var giftTender = new PaymentMethod { Id = Guid.NewGuid(), CompanyId = c.Id, Name = "Kartelë dhuratë", Kind = PaymentMethodKind.GiftCard, LedgerAccountId = advances };
        c.Db.PaymentMethods.Add(giftTender);
        await c.Db.SaveChangesAsync();
        var (_, register) = await SetupAsync(c);
        var session = await OpenAsync(c, register.Id);

        Assert.IsAssignableFrom<ObjectResult>((await Programs(c).CreateProgram(c.Id, new SaveProgramRequest("Laptopë −10%", ProgramKind.Promotion,
            ProgramRewardKind.PercentOff, Percent: 10m, ItemIds: new List<Guid> { c.Laptop }))).Result);
        Assert.IsAssignableFrom<ObjectResult>((await Programs(c).CreateProgram(c.Id, new SaveProgramRequest("Vera", ProgramKind.Coupon,
            ProgramRewardKind.AmountOff, Code: "vera5", Amount: 5m, Stackable: true))).Result);
        Assert.IsAssignableFrom<ObjectResult>((await Programs(c).CreateProgram(c.Id, new SaveProgramRequest("Pikë", ProgramKind.Loyalty,
            ProgramRewardKind.BasketDiscount, PointsPerEuro: 1m, PointValue: 0.01m))).Result);
        // A coupon without a code, or a second active loyalty program, is refused.
        Assert.IsType<BadRequestObjectResult>((await Programs(c).CreateProgram(c.Id, new SaveProgramRequest("X", ProgramKind.Coupon,
            ProgramRewardKind.AmountOff, Amount: 1m))).Result);
        Assert.IsType<BadRequestObjectResult>((await Programs(c).CreateProgram(c.Id, new SaveProgramRequest("Y", ProgramKind.Loyalty,
            ProgramRewardKind.BasketDiscount, PointsPerEuro: 2m, PointValue: 0.01m))).Result);
        var card = (LoyaltyCardResponse)Assert.IsAssignableFrom<ObjectResult>((await Programs(c).CreateLoyaltyCard(c.Id,
            new SaveLoyaltyCardRequest("L-1", "Arben"))).Result).Value!;

        // 236 − 10 % (23.60) − coupon 5 = 207.40; an unknown code is reported back.
        var laptop = new List<PosOrderLineRequest> { new(c.Laptop, "Laptop", 1m, 236m, null) };
        var quote = (PosQuoteResponse)Assert.IsType<OkObjectResult>((await Pos(c).Quote(c.Id, register.Id,
            new PosQuoteRequest(laptop, CouponCodes: new List<string> { "VERA5", "nope" }, LoyaltyCardNumber: "L-1"))).Result).Value!;
        Assert.Equal((207.40m, 28.60m, 2), (quote.Total, quote.Lines[0].ProgramDiscount, quote.Programs!.Count));
        Assert.Equal(new[] { "NOPE" }, quote.UnknownCodes);

        async Task<PosOrderResponse> Sale(PosOrderRequest r)
        {
            var result = Assert.IsAssignableFrom<ObjectResult>(await Submit(c, r));
            Assert.True(result.Value is PosOrderResponse, result.Value?.ToString());
            return (PosOrderResponse)result.Value!;
        }
        var first = await Sale(new PosOrderRequest(Guid.NewGuid(), session.Id, PosOrderKind.Sale, DateTime.UtcNow, laptop,
            new List<PosPaymentRequest> { new(c.Cash, 207.40m) }, CouponCodes: new List<string> { "VERA5" }, LoyaltyCardNumber: "L-1"));
        Assert.Equal((207.40m, 207m, 207m), (first.Total, first.PointsEarned, first.PointsBalance!.Value));
        Assert.Equal(1, (await c.Db.PosPrograms.AsNoTracking().SingleAsync(p => p.Code == "VERA5")).Uses);

        // 100 points (1.00) off the laptop, and a 50 gift card sold on a new number.
        var second = await Sale(new PosOrderRequest(Guid.NewGuid(), session.Id, PosOrderKind.Sale, DateTime.UtcNow,
            new List<PosOrderLineRequest> { new(c.Laptop, "Laptop", 1m, 236m, null), new(null, "Kartelë dhuratë", 1m, 50m, null, GiftCardNumber: "") },
            new List<PosPaymentRequest> { new(c.Cash, 261.40m) }, LoyaltyCardNumber: "L-1", RedeemPoints: 100m));
        var gift = Assert.Single(second.Cards!);
        Assert.Equal((GiftCardKind.GiftCard, 50m, 50m), (gift.Kind, gift.Change, gift.Balance));
        Assert.Equal((100m, 261m, 368m), (second.PointsRedeemed, second.PointsEarned, second.PointsBalance!.Value));
        Assert.Equal("A", second.Lines[1].TaxLetter);
        // A gift card sold can't come back.
        Assert.IsType<BadRequestObjectResult>(await Submit(c, new PosOrderRequest(Guid.NewGuid(), session.Id, PosOrderKind.Return, DateTime.UtcNow,
            new List<PosOrderLineRequest> { new(null, "x", 1m, 50m, null, OriginalLineId: second.Lines[1].Id) },
            new List<PosPaymentRequest> { new(c.Cash, 50m) }, OriginalOrderId: second.Id, Reason: "x")));

        // Spend the card: 50 on it, the rest in cash; it can't go below zero.
        var third = await Sale(new PosOrderRequest(Guid.NewGuid(), session.Id, PosOrderKind.Sale, DateTime.UtcNow, laptop,
            new List<PosPaymentRequest> { new(giftTender.Id, 50m, Reference: gift.Number), new(c.Cash, 162.40m) }));
        Assert.Equal(0m, Assert.Single(third.Cards!).Balance);
        Assert.IsType<BadRequestObjectResult>(await Submit(c, new PosOrderRequest(Guid.NewGuid(), session.Id, PosOrderKind.Sale, DateTime.UtcNow, laptop,
            new List<PosPaymentRequest> { new(giftTender.Id, 10m, Reference: gift.Number), new(c.Cash, 202.40m) })));

        // The laptop comes back as store credit on a new card.
        var refund = await Sale(new PosOrderRequest(Guid.NewGuid(), session.Id, PosOrderKind.Return, DateTime.UtcNow,
            new List<PosOrderLineRequest> { new(c.Laptop, "Laptop", 1m, 236m, null, OriginalLineId: third.Lines[0].Id) },
            new List<PosPaymentRequest> { new(giftTender.Id, 212.40m) }, OriginalOrderId: third.Id, Reason: "Ndërroi mendje"));
        var credit = Assert.Single(refund.Cards!);
        Assert.Equal((GiftCardKind.StoreCredit, 212.40m), (credit.Kind, credit.Balance));

        var closed = (await Pos(c).CloseSession(c.Id, session.Id, new CloseSessionRequest(new List<CountedTenderRequest>()))).Result;
        Assert.True(closed is OkObjectResult, (closed as BadRequestObjectResult)?.Value?.ToString());
        var entry = ((SessionReportResponse)((OkObjectResult)closed!).Value!).JournalEntryId!.Value;
        var lines = await c.Db.JournalEntryLines.AsNoTracking().Where(l => l.JournalEntryId == entry).ToListAsync();
        Assert.Equal(lines.Sum(l => l.Debit), lines.Sum(l => l.Credit));
        // 120800-style liability: 50 loaded, 50 spent, 212.40 owed as store credit.
        Assert.Equal(-212.40m, lines.Where(l => l.AccountId == advances).Sum(l => l.Debit - l.Credit));
    }

    [Fact]
    public async Task ItemsWithADeposit_SellOnlyWithTheirDepositLine()
    {
        var c = await SeedAsync();
        var bottle = new Item { Id = Guid.NewGuid(), CompanyId = c.Id, Code = 8, Name = "Kthim shishe", Unit = "copë", Type = ItemType.Service };
        c.Db.Items.Add(bottle);
        await c.Db.SaveChangesAsync();
        var laptop = await c.Db.Items.SingleAsync(i => i.Id == c.Laptop);
        laptop.DepositItemId = bottle.Id;
        await c.Db.SaveChangesAsync();
        var company = await c.Db.Companies.SingleAsync(x => x.Id == c.Id);
        company.IsVatRegistered = false;
        await c.Db.SaveChangesAsync();
        var (_, register) = await SetupAsync(c);
        var session = await OpenAsync(c, register.Id);
        Assert.IsType<BadRequestObjectResult>(await Submit(c, Sale(c, session.Id, 2m, new List<PosPaymentRequest> { new(c.Cash, 472m) })));
        var withDeposit = new PosOrderRequest(Guid.NewGuid(), session.Id, PosOrderKind.Sale, DateTime.UtcNow,
            new List<PosOrderLineRequest> { new(c.Laptop, "Laptop", 2m, 236m, null), new(bottle.Id, "Kthim shishe", 2m, 0.10m, null) },
            new List<PosPaymentRequest> { new(c.Cash, 472.20m) });
        Assert.IsAssignableFrom<ObjectResult>(await Submit(c, withDeposit));
    }

    // P2: a style with sizes and colours becomes one item per combination; the template isn't sold.
    [Fact]
    public async Task Variants_AreItemsOfTheirOwn_AndTheTemplateIsNotSold()
    {
        var c = await SeedAsync();
        var shirt = new Item { Id = Guid.NewGuid(), CompanyId = c.Id, Code = 50, Name = "Këmishë", Unit = "copë", Type = ItemType.Goods,
            DefaultUnitPrice = 25m, DefaultTaxDefinitionId = c.S18, TrackInventory = true };
        c.Db.Items.Add(shirt);
        await c.Db.SaveChangesAsync();
        var variants = As(new ItemVariantsController(c.Db, new NumberSeriesService(c.Db), new NullStringLocalizer<ErrorMessages>()), c.UserId);
        var size = (ItemAttributeResponse)Assert.IsAssignableFrom<ObjectResult>((await variants.CreateAttribute(c.Id, new SaveItemAttributeRequest("Masa", 1,
            new List<SaveItemAttributeValueRequest> { new(null, "M", 1), new(null, "L", 2) }))).Result).Value!;
        var colour = (ItemAttributeResponse)Assert.IsAssignableFrom<ObjectResult>((await variants.CreateAttribute(c.Id, new SaveItemAttributeRequest("Ngjyra", 2,
            new List<SaveItemAttributeValueRequest> { new(null, "Bardhë", 1), new(null, "Blu", 2) }))).Result).Value!;
        var made = (List<ItemVariantResponse>)Assert.IsType<OkObjectResult>((await variants.Generate(c.Id, shirt.Id, new GenerateVariantsRequest(
            size.Values.Select(v => v.Id).Concat(colour.Values.Select(v => v.Id)).ToList()))).Result).Value!;
        Assert.Equal(4, made.Count);
        Assert.Contains(made, v => v.Label == "M / Blu" && v.Name == "Këmishë M / Blu" && v.Price == 25m);
        // Generating again adds nothing; a value in use can't be removed.
        made = (List<ItemVariantResponse>)Assert.IsType<OkObjectResult>((await variants.Generate(c.Id, shirt.Id, new GenerateVariantsRequest(
            size.Values.Select(v => v.Id).Concat(colour.Values.Select(v => v.Id)).ToList()))).Result).Value!;
        Assert.Equal(4, made.Count);
        Assert.IsType<BadRequestObjectResult>((await variants.UpdateAttribute(c.Id, size.Id, new SaveItemAttributeRequest("Masa", 1,
            new List<SaveItemAttributeValueRequest> { new(size.Values[0].Id, "M", 1) }))).Result);

        var (_, register) = await SetupAsync(c);
        var catalog = (List<PosCatalogItemResponse>)Assert.IsType<OkObjectResult>((await Pos(c).Catalog(c.Id, register.Id)).Result).Value!;
        Assert.DoesNotContain(catalog, i => i.Id == shirt.Id);
        Assert.Equal(4, catalog.Count(i => i.VariantOfItemId == shirt.Id && i.VariantLabel != null));
        var session = await OpenAsync(c, register.Id);
        Assert.IsType<BadRequestObjectResult>(await Submit(c, new PosOrderRequest(Guid.NewGuid(), session.Id, PosOrderKind.Sale, DateTime.UtcNow,
            new List<PosOrderLineRequest> { new(shirt.Id, "Këmishë", 1m, 25m, null) }, new List<PosPaymentRequest> { new(c.Cash, 25m) })));
    }

    // P2: a phone sells with its IMEI; the warranty desk finds it; it can't be sold twice; a return
    // frees it.
    [Fact]
    public async Task Serials_AreRecordedWithTheirWarranty()
    {
        var c = await SeedAsync();
        var laptop = await c.Db.Items.SingleAsync(i => i.Id == c.Laptop);
        laptop.TrackSerials = true;
        laptop.WarrantyMonths = 24;
        await c.Db.SaveChangesAsync();
        var (_, register) = await SetupAsync(c);
        var session = await OpenAsync(c, register.Id);
        PosOrderRequest Sell(string? serial, decimal qty = 1m) => new(Guid.NewGuid(), session.Id, PosOrderKind.Sale, new DateTime(2026, 10, 31, 10, 0, 0, DateTimeKind.Utc),
            new List<PosOrderLineRequest> { new(c.Laptop, "Laptop", qty, 236m, null, SerialNumber: serial) }, new List<PosPaymentRequest> { new(c.Cash, 236m * qty) });
        Assert.IsType<BadRequestObjectResult>(await Submit(c, Sell(null)));
        Assert.IsType<BadRequestObjectResult>(await Submit(c, Sell("IMEI-1", 2m)));
        var sale = (PosOrderResponse)Assert.IsAssignableFrom<ObjectResult>(await Submit(c, Sell("IMEI-1"))!).Value!;
        Assert.IsType<BadRequestObjectResult>(await Submit(c, Sell("IMEI-1")));

        var found = Assert.Single((List<SerialLookupResponse>)Assert.IsType<OkObjectResult>((await Pos(c).Serial(c.Id, "IMEI-1")).Result).Value!);
        Assert.Equal((ItemSerialStatus.Sold, new DateOnly(2028, 10, 31), true, sale.Number), (found.Status, found.WarrantyUntil!.Value, found.UnderWarranty, found.OrderNumber));

        Assert.IsAssignableFrom<ObjectResult>(await Submit(c, new PosOrderRequest(Guid.NewGuid(), session.Id, PosOrderKind.Return, DateTime.UtcNow,
            new List<PosOrderLineRequest> { new(c.Laptop, "Laptop", 1m, 236m, null, OriginalLineId: sale.Lines[0].Id) },
            new List<PosPaymentRequest> { new(c.Cash, 236m) }, OriginalOrderId: sale.Id, Reason: "Defekt")));
        found = Assert.Single((List<SerialLookupResponse>)Assert.IsType<OkObjectResult>((await Pos(c).Serial(c.Id, "IMEI-1")).Result).Value!);
        Assert.Equal(ItemSerialStatus.Returned, found.Status);
        Assert.IsAssignableFrom<ObjectResult>(await Submit(c, Sell("IMEI-1")));
    }

    // P2: sales by item with the margin on the cost snapshot; shelf labels print.
    [Fact]
    public async Task Reports_GroupSalesWithMargin_AndLabelsPrint()
    {
        var c = await SeedAsync();
        var (store, register) = await SetupAsync(c);
        var session = await OpenAsync(c, register.Id);
        var sale = (PosOrderResponse)Assert.IsAssignableFrom<ObjectResult>(await Submit(c, Sale(c, session.Id, 2m,
            new List<PosPaymentRequest> { new(c.Cash, 472m) }))!).Value!;
        Assert.IsAssignableFrom<ObjectResult>(await Submit(c, new PosOrderRequest(Guid.NewGuid(), session.Id, PosOrderKind.Return, DateTime.UtcNow,
            new List<PosOrderLineRequest> { new(c.Laptop, "Laptop", 1m, 236m, null, OriginalLineId: sale.Lines[0].Id) },
            new List<PosPaymentRequest> { new(c.Cash, 236m) }, OriginalOrderId: sale.Id, Reason: "x")));
        var reports = As(new PosReportsController(c.Db, new PosReportService(c.Db),
            new PriceListService(c.Db, new StockService(c.Db, new NullStringLocalizer<ErrorMessages>()), new NumberSeriesService(c.Db), new NullStringLocalizer<ErrorMessages>()),
            new NullStringLocalizer<ErrorMessages>()), c.UserId);
        var day = new DateOnly(2026, 10, 31);
        var byItem = (PosSalesReportResponse)Assert.IsType<OkObjectResult>((await reports.Sales(c.Id, day.AddDays(-1), day.AddDays(1), PosReportGroup.Item)).Result).Value!;
        var row = Assert.Single(byItem.Rows);
        // 2 sold (472), 1 back (236): net 236 gross, 200 net of VAT, cost 100 → margin 100.
        Assert.Equal((1, 1m, 472m, 236m, 236m, 36m, 100m, 100m), (row.Orders, row.Quantity, row.Sales, row.Returns, row.NetSales, row.Tax, row.Cost!.Value, row.Margin!.Value));
        var byTender = (PosSalesReportResponse)Assert.IsType<OkObjectResult>((await reports.Sales(c.Id, day.AddDays(-1), day.AddDays(1), PosReportGroup.Tender)).Result).Value!;
        Assert.Equal(236m, Assert.Single(byTender.Rows).NetSales);
        Assert.IsType<BadRequestObjectResult>((await reports.Sales(c.Id, day, day.AddDays(-1), PosReportGroup.Day)).Result);

        var pdf = Assert.IsType<FileContentResult>(await reports.Labels(c.Id, store.Id, new List<Guid> { c.Laptop }));
        Assert.Equal("%PDF", System.Text.Encoding.ASCII.GetString(pdf.FileContents, 0, 4));
    }

    // P2: a special order is paid for in deposits, collected at the till with them, or cancelled
    // with the deposits paid back in cash.
    [Fact]
    public async Task CustomerOrders_TakeDeposits_AndAreCollectedOrRefunded()
    {
        var c = await SeedAsync();
        var advances = c.Account("240300");
        var giftTender = new PaymentMethod { Id = Guid.NewGuid(), CompanyId = c.Id, Name = "Depozita", Kind = PaymentMethodKind.GiftCard, LedgerAccountId = advances };
        c.Db.PaymentMethods.Add(giftTender);
        (await c.Db.Items.SingleAsync(i => i.Id == c.Laptop)).DefaultUnitPrice = 236m;
        await c.Db.SaveChangesAsync();
        var (store, register) = await SetupAsync(c);
        var session = await OpenAsync(c, register.Id);
        var orders = As(new CustomerOrdersController(c.Db,
            new PriceListService(c.Db, new StockService(c.Db, new NullStringLocalizer<ErrorMessages>()), new NumberSeriesService(c.Db), new NullStringLocalizer<ErrorMessages>()),
            new NullStringLocalizer<ErrorMessages>()), c.UserId);
        var created = Assert.IsAssignableFrom<ObjectResult>((await orders.Create(c.Id, new SaveCustomerOrderRequest(store.Id,
            CustomerOrderKind.SpecialOrder, c.Customer, new List<SaveCustomerOrderLineRequest> { new(c.Laptop, 1m, 230m) }))).Result);
        Assert.True(created.Value is CustomerOrderResponse, created.Value?.ToString());
        var order = (CustomerOrderResponse)created.Value!;
        Assert.Equal(("CO-00001", 230m, 230m), (order.Number, order.Total, order.Remaining));

        // A 100 deposit at the till loads the order's deposit card.
        Assert.IsAssignableFrom<ObjectResult>(await Submit(c, new PosOrderRequest(Guid.NewGuid(), session.Id, PosOrderKind.Sale, DateTime.UtcNow,
            new List<PosOrderLineRequest> { new(null, "Depozitë CO-00001", 1m, 100m, null, GiftCardNumber: order.DepositCardNumber) },
            new List<PosPaymentRequest> { new(c.Cash, 100m) })));
        order = (CustomerOrderResponse)Assert.IsType<OkObjectResult>((await orders.Get(c.Id, order.Id)).Result).Value!;
        Assert.Equal((100m, 130m), (order.Deposited, order.Remaining));

        // Collected: the laptop at the agreed price, the deposit spent, the rest in cash.
        var collect = (PosOrderResponse)Assert.IsAssignableFrom<ObjectResult>(await Submit(c, new PosOrderRequest(Guid.NewGuid(), session.Id, PosOrderKind.Sale,
            DateTime.UtcNow, new List<PosOrderLineRequest> { new(c.Laptop, "Laptop", 1m, 230m, null) },
            new List<PosPaymentRequest> { new(giftTender.Id, 100m, Reference: order.DepositCardNumber), new(c.Cash, 130m) }, CustomerOrderId: order.Id))!).Value!;
        Assert.Equal(c.Customer, collect.CustomerId);
        order = (CustomerOrderResponse)Assert.IsType<OkObjectResult>((await orders.Get(c.Id, order.Id)).Result).Value!;
        Assert.Equal((CustomerOrderState.Collected, collect.Id), (order.State, order.CollectedOrderId!.Value));

        // A second order is cancelled: its 50 deposit goes back from the drawer.
        var second = (CustomerOrderResponse)Assert.IsAssignableFrom<ObjectResult>((await orders.Create(c.Id, new SaveCustomerOrderRequest(store.Id,
            CustomerOrderKind.Layaway, c.Customer, new List<SaveCustomerOrderLineRequest> { new(c.Laptop, 1m) }))).Result).Value!;
        Assert.Equal(236m, second.Total);
        Assert.IsAssignableFrom<ObjectResult>(await Submit(c, new PosOrderRequest(Guid.NewGuid(), session.Id, PosOrderKind.Sale, DateTime.UtcNow,
            new List<PosOrderLineRequest> { new(null, "Depozitë", 1m, 50m, null, GiftCardNumber: second.DepositCardNumber) },
            new List<PosPaymentRequest> { new(c.Cash, 50m) })));
        Assert.IsType<BadRequestObjectResult>((await orders.Cancel(c.Id, second.Id, new CancelCustomerOrderRequest("Ndërroi mendje"))).Result);
        var cancelled = (CustomerOrderResponse)Assert.IsType<OkObjectResult>((await orders.Cancel(c.Id, second.Id,
            new CancelCustomerOrderRequest("Ndërroi mendje", session.Id))).Result).Value!;
        Assert.Equal(CustomerOrderState.Cancelled, cancelled.State);
        var x = (SessionReportResponse)Assert.IsType<OkObjectResult>((await Pos(c).SessionReport(c.Id, session.Id)).Result).Value!;
        // 50 float + 100 + 130 + 50 − 50 paid back.
        Assert.Equal(280m, x.CashExpected);

        var closed = (await Pos(c).CloseSession(c.Id, session.Id, new CloseSessionRequest(new List<CountedTenderRequest>()))).Result;
        Assert.True(closed is OkObjectResult, (closed as BadRequestObjectResult)?.Value?.ToString());
        var entry = ((SessionReportResponse)((OkObjectResult)closed!).Value!).JournalEntryId!.Value;
        var lines = await c.Db.JournalEntryLines.AsNoTracking().Where(l => l.JournalEntryId == entry).ToListAsync();
        // Deposits in (150), spent (100), paid back (50): nothing left owed.
        Assert.Equal(0m, lines.Where(l => l.AccountId == advances).Sum(l => l.Debit - l.Credit));
        Assert.Contains(lines, l => l.AccountId == advances && l.PartnerId == c.Customer);
    }

    // ---- P3: hospitality ----

    private static TabService Tabs(Co c) => new(c.Db,
        new PriceListService(c.Db, new StockService(c.Db, new NullStringLocalizer<ErrorMessages>()), new NumberSeriesService(c.Db), new NullStringLocalizer<ErrorMessages>()),
        new NullStringLocalizer<ErrorMessages>());

    private sealed class NoHub : Microsoft.AspNetCore.SignalR.IHubContext<Pako.Api.Hubs.PosHub>
    {
        public Microsoft.AspNetCore.SignalR.IHubClients Clients { get; } = new NoClients();
        public Microsoft.AspNetCore.SignalR.IGroupManager Groups => throw new NotSupportedException();

        private sealed class NoClients : Microsoft.AspNetCore.SignalR.IHubClients
        {
            private static readonly Microsoft.AspNetCore.SignalR.IClientProxy Proxy = new NoProxy();
            public Microsoft.AspNetCore.SignalR.IClientProxy All => Proxy;
            public Microsoft.AspNetCore.SignalR.IClientProxy AllExcept(IReadOnlyList<string> excludedConnectionIds) => Proxy;
            public Microsoft.AspNetCore.SignalR.IClientProxy Client(string connectionId) => Proxy;
            public Microsoft.AspNetCore.SignalR.IClientProxy Clients(IReadOnlyList<string> connectionIds) => Proxy;
            public Microsoft.AspNetCore.SignalR.IClientProxy Group(string groupName) => Proxy;
            public Microsoft.AspNetCore.SignalR.IClientProxy GroupExcept(string groupName, IReadOnlyList<string> excludedConnectionIds) => Proxy;
            public Microsoft.AspNetCore.SignalR.IClientProxy Groups(IReadOnlyList<string> groupNames) => Proxy;
            public Microsoft.AspNetCore.SignalR.IClientProxy User(string userId) => Proxy;
            public Microsoft.AspNetCore.SignalR.IClientProxy Users(IReadOnlyList<string> userIds) => Proxy;
        }

        private sealed class NoProxy : Microsoft.AspNetCore.SignalR.IClientProxy
        {
            public Task SendCoreAsync(string method, object?[] args, CancellationToken cancellationToken = default) => Task.CompletedTask;
        }
    }

    private static PosTabsController TabsApi(Co c) => As(new PosTabsController(c.Db, Tabs(c), new Pako.Api.Hubs.PosNotifier(new NoHub()),
        new NullStringLocalizer<ErrorMessages>(), CompanyAccessContext.Unrestricted(), Operators(c)), c.UserId);

    private static PosMenuController MenuApi(Co c) => As(new PosMenuController(c.Db, new NullStringLocalizer<ErrorMessages>()), c.UserId);

    private static T Ok<T>(ActionResult<T> result) where T : class
    {
        var obj = Assert.IsAssignableFrom<ObjectResult>(result.Result);
        Assert.True(obj.Value is T, obj.Value?.ToString());
        return (T)obj.Value!;
    }

    // A restaurant evening: a table orders a pizza with extra cheese and a menu (burger + choice of
    // drink), the kitchen and bar get their tickets, a sent dish is voided (STORNO), the table
    // splits the bill in two and pays both parts; the tab closes and the session books it all.
    [Fact]
    public async Task Restaurant_TabsTicketsAndSplitBills()
    {
        var c = await SeedAsync();
        var (store, register) = await SetupAsync(c);
        var session = await OpenAsync(c, register.Id);
        var kitchen = Ok(await MenuApi(c).CreateCenter(c.Id, new SaveProductionCenterRequest("Kuzhina", ProductionCenterKind.Kitchen)));
        var bar = Ok(await MenuApi(c).CreateCenter(c.Id, new SaveProductionCenterRequest("Bari", ProductionCenterKind.Bar)));
        Item Dish(string name, decimal price, Guid center) => new()
        {
            Id = Guid.NewGuid(), CompanyId = c.Id, Code = 100 + name.Length * 7 + (int)price, Name = name, Unit = "copë", Type = ItemType.Service,
            DefaultUnitPrice = price, DefaultTaxDefinitionId = c.S18, ProductionCenterId = center,
        };
        var pizza = Dish("Pica Margarita", 6m, kitchen.Id);
        var burger = Dish("Menu Burger", 8m, kitchen.Id);
        var cola = Dish("Coca-Cola", 1.5m, bar.Id);
        var beer = Dish("Birrë Peja", 2m, bar.Id);
        c.Db.Items.AddRange(pizza, burger, cola, beer);
        await c.Db.SaveChangesAsync();
        var extras = Ok(await MenuApi(c).CreateGroup(c.Id, new SaveModifierGroupRequest("Shtesa", 0, 3,
            new List<SaveModifierRequest> { new(null, "Extra djathë", 0.5m), new(null, "Pa qepë") }, new List<Guid> { pizza.Id })));
        Ok(await MenuApi(c).SaveCombo(c.Id, burger.Id, new SaveComboRequest(new List<SaveComboSlotRequest>
            { new("Pije", 1, 1, new List<ComboChoiceResponse> { new(cola.Id, 0m), new(beer.Id, 0.5m) }) })));

        var floor = Ok(await TabsApi(c).CreateFloor(c.Id, new SaveFloorRequest(store.Id, "Salla")));
        var table = Ok(await TabsApi(c).CreateTable(c.Id, new SaveTableRequest(floor.Id, "T1", 4)));
        var tab = Ok(await TabsApi(c).Open(c.Id, new OpenTabRequest(store.Id, table.Id, Covers: 2)));

        // A modifier that isn't offered, or a combo without its drink, is refused.
        Assert.IsType<BadRequestObjectResult>((await TabsApi(c).AddLines(c.Id, tab.Id, new AddTabLinesRequest(new List<AddTabLineRequest>
            { new(burger.Id, 1m, ModifierIds: new List<Guid> { extras.Modifiers[0].Id }) }))).Result);
        Assert.IsType<BadRequestObjectResult>((await TabsApi(c).AddLines(c.Id, tab.Id, new AddTabLinesRequest(new List<AddTabLineRequest>
            { new(burger.Id, 1m) }))).Result);

        tab = Ok(await TabsApi(c).AddLines(c.Id, tab.Id, new AddTabLinesRequest(new List<AddTabLineRequest>
        {
            new(pizza.Id, 2m, ModifierIds: new List<Guid> { extras.Modifiers[0].Id }, Note: "e hollë"),
            new(burger.Id, 1m, ComboChoices: new List<ComboChoiceRequest> { new(Ok(await MenuApi(c).Combo(c.Id, burger.Id))[0].Id, beer.Id) }),
            new(cola.Id, 1m),
        })));
        // Pizza 6.50 × 2 + burger menu 8.50 (beer +0.50) + its beer at 0 + cola 1.50 = 23.00.
        Assert.Equal((23m, 23m, 4), (tab.Total, tab.Due, tab.Lines.Count));
        Assert.Equal("Extra djathë", tab.Lines[0].Modifiers);
        Assert.Equal(tab.Lines[1].Id, tab.Lines[2].ParentLineId);

        // Sending: one ticket for the kitchen (pizza, burger), one for the bar (beer, cola).
        tab = Ok(await TabsApi(c).Send(c.Id, tab.Id));
        Assert.All(tab.Lines, l => Assert.Equal(TabLineState.Sent, l.State));
        var tickets = Ok(await TabsApi(c).Tickets(c.Id, store.Id));
        Assert.Equal(2, tickets.Count);
        Assert.Equal(2, tickets.Single(t => t.ProductionCenterId == bar.Id).Lines.Count);
        Assert.Equal("T1", tickets[0].TabLabel);

        // The cola is voided after sending: a STORNO ticket for the bar.
        tab = Ok(await TabsApi(c).VoidLine(c.Id, tab.Id, tab.Lines[3].Id, new VoidTabLineRequest("Gabim")));
        Assert.Equal(21.5m, tab.Due);
        tickets = Ok(await TabsApi(c).Tickets(c.Id, store.Id));
        Assert.Single(tickets, t => t.IsStorno && t.ProductionCenterId == bar.Id);
        Assert.IsType<NoContentResult>(await TabsApi(c).TicketState(c.Id, tickets[0].Id, new KitchenTicketStateRequest(KitchenTicketState.Done)));
        Assert.Equal(2, Ok(await TabsApi(c).Tickets(c.Id, store.Id)).Count);

        // Pre-bill, then an equal split in two: each part pays half of every line.
        tab = Ok(await TabsApi(c).PreBill(c.Id, tab.Id));
        Assert.Equal((TabState.PreBilled, 1), (tab.State, tab.PreBillCount));
        var split = Ok(await TabsApi(c).Split(c.Id, tab.Id, 2));
        Assert.Equal(21.5m, split.Parts.Sum(p => p.Total));
        foreach (var part in split.Parts)
        {
            var order = new PosOrderRequest(Guid.NewGuid(), session.Id, PosOrderKind.Sale, DateTime.UtcNow,
                part.Lines.Select(l => new PosOrderLineRequest(null, "", l.Quantity, 0m, null, TabLineId: l.TabLineId)).ToList(),
                new List<PosPaymentRequest> { new(c.Cash, part.Total) }, TabId: tab.Id);
            var paid = (PosOrderResponse)Assert.IsAssignableFrom<ObjectResult>(await Submit(c, order)!).Value!;
            Assert.Equal(part.Total, paid.Total);
        }
        tab = Ok(await TabsApi(c).Get(c.Id, tab.Id));
        Assert.Equal((TabState.Closed, 0m, 21.5m), (tab.State, tab.Due, tab.Paid));
        // Nothing more can be paid on it.
        Assert.IsType<BadRequestObjectResult>(await Submit(c, new PosOrderRequest(Guid.NewGuid(), session.Id, PosOrderKind.Sale, DateTime.UtcNow,
            new List<PosOrderLineRequest> { new(null, "", 1m, 0m, null, TabLineId: tab.Lines[0].Id) }, new List<PosPaymentRequest> { new(c.Cash, 6.5m) }, TabId: tab.Id)));

        var closed = (await Pos(c).CloseSession(c.Id, session.Id, new CloseSessionRequest(new List<CountedTenderRequest>()))).Result;
        Assert.True(closed is OkObjectResult, (closed as BadRequestObjectResult)?.Value?.ToString());
        var x = (SessionReportResponse)((OkObjectResult)closed!).Value!;
        Assert.Equal(21.5m, x.NetSales);
    }

    // Tables pushed together, lines moved, a tab with nothing sent cancelled; the QR menu asks for
    // dishes that wait for the waiter.
    [Fact]
    public async Task Tabs_MoveMerge_AndQrRequests()
    {
        var c = await SeedAsync();
        var (store, _) = await SetupAsync(c);
        var kitchen = Ok(await MenuApi(c).CreateCenter(c.Id, new SaveProductionCenterRequest("Kuzhina", ProductionCenterKind.Kitchen)));
        var soup = new Item { Id = Guid.NewGuid(), CompanyId = c.Id, Code = 300, Name = "Supë", Unit = "copë", Type = ItemType.Service,
            DefaultUnitPrice = 3m, DefaultTaxDefinitionId = c.S18, ProductionCenterId = kitchen.Id };
        c.Db.Items.Add(soup);
        await c.Db.SaveChangesAsync();
        var floor = Ok(await TabsApi(c).CreateFloor(c.Id, new SaveFloorRequest(store.Id, "Terasa")));
        var t1 = Ok(await TabsApi(c).CreateTable(c.Id, new SaveTableRequest(floor.Id, "A1")));
        var t2 = Ok(await TabsApi(c).CreateTable(c.Id, new SaveTableRequest(floor.Id, "A2")));
        var a = Ok(await TabsApi(c).Open(c.Id, new OpenTabRequest(store.Id, t1.Id)));
        var b = Ok(await TabsApi(c).Open(c.Id, new OpenTabRequest(store.Id, t2.Id)));
        a = Ok(await TabsApi(c).AddLines(c.Id, a.Id, new AddTabLinesRequest(new List<AddTabLineRequest> { new(soup.Id, 1m), new(soup.Id, 2m) })));
        b = Ok(await TabsApi(c).AddLines(c.Id, b.Id, new AddTabLinesRequest(new List<AddTabLineRequest> { new(soup.Id, 1m) })));

        // One soup moves to A2, then A2 joins A1: A2 closes, A1 has everything.
        // The answer is the tab the lines left.
        a = Ok(await TabsApi(c).MoveLines(c.Id, a.Id, new MoveTabLinesRequest(new List<Guid> { a.Lines[0].Id }, b.Id)));
        Assert.Single(a.Lines);
        Assert.Equal(2, Ok(await TabsApi(c).Get(c.Id, b.Id)).Lines.Count);
        a = Ok(await TabsApi(c).Merge(c.Id, a.Id, new MergeTabRequest(b.Id)));
        Assert.Equal((4m * 3m, 3), (a.Due, a.Lines.Count));
        Assert.Equal(TabState.Cancelled, Ok(await TabsApi(c).Get(c.Id, b.Id)).State);
        var plan = Ok(await TabsApi(c).FloorPlan(c.Id, store.Id));
        Assert.Single(plan.Floors[0].Tables.Single(t => t.Id == t1.Id).Tabs);
        Assert.Empty(plan.Floors[0].Tables.Single(t => t.Id == t2.Id).Tabs);

        // The QR menu shows the soup; a guest's order waits as a request.
        var qr = As(new PublicMenuController(c.Db,
            new PriceListService(c.Db, new StockService(c.Db, new NullStringLocalizer<ErrorMessages>()), new NumberSeriesService(c.Db), new NullStringLocalizer<ErrorMessages>()),
            Tabs(c), new Pako.Api.Hubs.PosNotifier(new NoHub()), new NullStringLocalizer<ErrorMessages>()), c.UserId);
        var menu = Ok(await qr.Get(t2.QrToken));
        Assert.Contains(menu.Items, i => i.Id == soup.Id && i.Price == 3m);
        Assert.IsType<NotFoundResult>((await qr.Get("nope")).Result);
        Assert.IsType<NoContentResult>(await qr.Order(t2.QrToken, new PublicOrderRequest(new List<PublicOrderLineRequest> { new(soup.Id, 2m) })));
        var requested = Ok(await TabsApi(c).OpenTabs(c.Id, store.Id)).Single(t => t.TableId == t2.Id);
        Assert.Equal((1, 0m), (requested.RequestedLines, requested.Due));
        var accepted = Ok(await TabsApi(c).Requested(c.Id, requested.Id, accept: true));
        Assert.Equal((6m, TabLineState.Pending), (accepted.Due, accepted.Lines[0].State));

        // A tab with nothing sent can be cancelled; one the kitchen has can't.
        Assert.Equal(TabState.Cancelled, Ok(await TabsApi(c).Cancel(c.Id, accepted.Id)).State);
        a = Ok(await TabsApi(c).Send(c.Id, a.Id));
        Assert.IsType<BadRequestObjectResult>((await TabsApi(c).Cancel(c.Id, a.Id)).Result);
    }

    // P3: a burger's recipe (and its extra-cheese modifier) issues bun, beef and cheese; the cost
    // is the ingredients'; a recipe can't contain itself; a count shows the beef's variance.
    [Fact]
    public async Task Recipes_IssueIngredients_AndUsageVarianceShowsTheShortage()
    {
        var c = await SeedAsync();
        var (store, _) = await SetupAsync(c);
        Item Ingredient(string name, string unit, int code) => new() { Id = Guid.NewGuid(), CompanyId = c.Id, Code = code, Name = name, Unit = unit,
            Type = ItemType.Goods, TrackInventory = true };
        var bun = Ingredient("Bukë burgeri", "copë", 401);
        var beef = Ingredient("Mish viçi", "kg", 402);
        var cheese = Ingredient("Djathë", "kg", 403);
        var burger = new Item { Id = Guid.NewGuid(), CompanyId = c.Id, Code = 404, Name = "Burger", Unit = "copë", Type = ItemType.Normative,
            DefaultUnitPrice = 5m, DefaultTaxDefinitionId = c.S18 };
        c.Db.Items.AddRange(bun, beef, cheese, burger);
        await c.Db.SaveChangesAsync();
        var documents = As(new StockDocumentsController(c.Db, new StockDocumentService(c.Db, new StockService(c.Db, new NullStringLocalizer<ErrorMessages>()),
            new NumberSeriesService(c.Db), new NullStringLocalizer<ErrorMessages>(), Tax), new StockService(c.Db, new NullStringLocalizer<ErrorMessages>()),
            new NullStringLocalizer<ErrorMessages>()), c.UserId);
        async Task Post(SaveStockDocumentRequest r)
        {
            var created = (StockDocumentResponse)Assert.IsAssignableFrom<ObjectResult>((await documents.Create(c.Id, r)).Result).Value!;
            Assert.IsType<OkObjectResult>((await documents.Post(c.Id, created.Id)).Result);
        }
        await Post(new SaveStockDocumentRequest(StockDocumentType.Opening, new DateOnly(2026, 10, 1), c.Warehouse,
            new List<StockDocumentLineRequest> { new(bun.Id, 10m, 0.2m), new(beef.Id, 1m, 8m), new(cheese.Id, 1m, 10m) }));

        var items = As(new ItemVariantsController(c.Db, new NumberSeriesService(c.Db), new NullStringLocalizer<ErrorMessages>()), c.UserId);
        Assert.IsType<OkObjectResult>((await items.SaveRecipe(c.Id, burger.Id, new SaveRecipeRequest(new List<SaveRecipeLineRequest>
            { new(bun.Id, 1m), new(beef.Id, 0.15m, 10m) }))).Result);
        // The bun can't be made of burgers.
        Assert.IsType<BadRequestObjectResult>((await items.SaveRecipe(c.Id, bun.Id, new SaveRecipeRequest(new List<SaveRecipeLineRequest> { new(burger.Id, 1m) }))).Result);
        var extra = Ok(await MenuApi(c).CreateGroup(c.Id, new SaveModifierGroupRequest("Shtesa", 0, 2,
            new List<SaveModifierRequest> { new(null, "Djathë", 0.5m, cheese.Id, 0.02m) }, new List<Guid> { burger.Id })));

        var register = Ok(await Pos(c).CreateRegister(c.Id, new SaveRegisterRequest(store.Id, "K9", "Bar", RegisterProfile.Restaurant, FiscalMode.Training, 9,
            c.Account("100100"))));
        var session = await OpenAsync(c, register.Id);
        var tab = Ok(await TabsApi(c).Open(c.Id, new OpenTabRequest(store.Id)));
        tab = Ok(await TabsApi(c).AddLines(c.Id, tab.Id, new AddTabLinesRequest(new List<AddTabLineRequest>
            { new(burger.Id, 2m, ModifierIds: new List<Guid> { extra.Modifiers[0].Id }) })));
        Assert.Equal(11m, tab.Due);
        var paid = (PosOrderResponse)Assert.IsAssignableFrom<ObjectResult>(await Submit(c, new PosOrderRequest(Guid.NewGuid(), session.Id, PosOrderKind.Sale,
            new DateTime(2026, 10, 31, 12, 0, 0, DateTimeKind.Utc), new List<PosOrderLineRequest> { new(null, "", 2m, 0m, null, TabLineId: tab.Lines[0].Id) },
            new List<PosPaymentRequest> { new(c.Cash, 11m) }, TabId: tab.Id))!).Value!;
        Assert.Contains("Djathë", paid.Lines[0].Description);

        decimal OnHand(Item i) => c.Db.ItemCosts.AsNoTracking().Single(k => k.ItemId == i.Id).Quantity;
        // 2 buns, 2 × 0.15 × 1.10 = 0.33 kg beef, 2 × 0.02 = 0.04 kg cheese; no burger stock at all.
        Assert.Equal((8m, 0.67m, 0.96m), (OnHand(bun), OnHand(beef), OnHand(cheese)));
        Assert.False(c.Db.ItemCosts.Any(k => k.ItemId == burger.Id));
        // Cost of the line: 0.40 + 2.64 + 0.40.
        Assert.Equal(3.44m, (await c.Db.PosOrderLines.AsNoTracking().SingleAsync(l => l.OrderId == paid.Id)).CostValue);

        // The count finds 0.60 kg of beef where 0.67 should be: 0.07 short of 0.33 used ≈ 21 %.
        await Post(new SaveStockDocumentRequest(StockDocumentType.Count, new DateOnly(2026, 10, 31), c.Warehouse,
            new List<StockDocumentLineRequest> { new(beef.Id, 0.6m) }));
        var reports = As(new PosReportsController(c.Db, new PosReportService(c.Db),
            new PriceListService(c.Db, new StockService(c.Db, new NullStringLocalizer<ErrorMessages>()), new NumberSeriesService(c.Db), new NullStringLocalizer<ErrorMessages>()),
            new NullStringLocalizer<ErrorMessages>()), c.UserId);
        var usage = Ok(await reports.UsageVariance(c.Id, new DateOnly(2026, 10, 30), new DateOnly(2026, 11, 1)));
        var row = usage.Rows.Single(r => r.ItemId == beef.Id);
        Assert.Equal((0.33m, -0.07m, 21.21m), (row.Theoretical, row.CountDifference, row.VariancePercent!.Value));
    }

    // P3: a waiter signs in with a PIN on the shared till — the order is theirs; a tip rides on the
    // card and is owed to staff; at the end the waiter hands over 2.00 short, which they owe.
    [Fact]
    public async Task Waiters_SignInWithPins_TakeTips_AndSettleTheirCash()
    {
        var c = await SeedAsync();
        var (store, register) = await SetupAsync(c);
        var session = await OpenAsync(c, register.Id);
        // This chart has no 222100 (a payroll-profile account): the store names its tips account.
        var tipsStore = await c.Db.PosStores.SingleAsync(s => s.Id == store.Id);
        tipsStore.TipsAccountId = c.Account("240300");
        await c.Db.SaveChangesAsync();
        var waiter = Guid.NewGuid();
        c.Db.Memberships.Add(new Membership { Id = Guid.NewGuid(), UserId = waiter, CompanyId = c.Id, Role = MembershipRole.ClientAdmin, IsActive = true });
        c.Db.Employees.Add(new Pako.Domain.Payroll.Employee { Id = Guid.NewGuid(), CompanyId = c.Id, UserId = waiter, Name = "Drita Krasniqi" });
        await c.Db.SaveChangesAsync();

        // Each member sets their own PIN; two can't share one.
        Assert.IsType<NoContentResult>(await As(Pos(c), waiter).SetPin(c.Id, new SetPosPinRequest("4321")));
        Assert.IsType<BadRequestObjectResult>(await Pos(c).SetPin(c.Id, new SetPosPinRequest("4321")));
        Assert.IsType<BadRequestObjectResult>(await Pos(c).SetPin(c.Id, new SetPosPinRequest("12")));
        Assert.IsType<BadRequestObjectResult>((await Pos(c).PinSignIn(c.Id, new PosPinSignInRequest("0000"))).Result);
        var signedIn = Ok(await Pos(c).PinSignIn(c.Id, new PosPinSignInRequest("4321")));
        Assert.Equal((waiter, "Drita Krasniqi"), (signedIn.UserId, signedIn.Name));

        PosController AsWaiter()
        {
            var api = Pos(c);
            api.ControllerContext.HttpContext.Request.Headers[PosOperatorService.Header] = signedIn.Token;
            return api;
        }
        // 236 cash (300 handed) with a 4.00 tip; 236 on card with a 6.00 tip.
        var first = (PosOrderResponse)((ObjectResult)(await AsWaiter().SubmitOrder(c.Id, Sale(c, session.Id, 1m,
            new List<PosPaymentRequest> { new(c.Cash, 236m, 300m, Tip: 4m) }))).Result!).Value!;
        Assert.Equal(("Drita Krasniqi", 60m), (first.OperatorName, first.Change));
        Assert.IsAssignableFrom<ObjectResult>((await AsWaiter().SubmitOrder(c.Id, Sale(c, session.Id, 1m,
            new List<PosPaymentRequest> { new(c.Card, 236m, Tip: 6m) }))).Result);
        // A forged token is just the terminal itself.
        var forged = Pos(c);
        forged.ControllerContext.HttpContext.Request.Headers[PosOperatorService.Header] = "nope";
        var own = (PosOrderResponse)((ObjectResult)(await forged.SubmitOrder(c.Id, Sale(c, session.Id, 1m,
            new List<PosPaymentRequest> { new(c.Cash, 236m) }))).Result!).Value!;
        Assert.NotEqual("Drita Krasniqi", own.OperatorName);

        var waiters = Ok(await Pos(c).Waiters(c.Id, session.Id));
        var drita = waiters.Single(w => w.WaiterUserId == waiter);
        Assert.Equal((2, 472m, 236m, 236m, 10m, 240m), (drita.Orders, drita.NetSales, drita.Cash, drita.OtherTenders, drita.Tips, drita.CashExpected));
        // She hands over 238: 2.00 short needs a reason.
        Assert.IsType<BadRequestObjectResult>((await Pos(c).SettleWaiter(c.Id, session.Id, new SettleWaiterRequest(waiter, 238m))).Result);
        var settled = Ok(await Pos(c).SettleWaiter(c.Id, session.Id, new SettleWaiterRequest(waiter, 238m, "Kusur i gabuar")));
        Assert.Equal(-2m, settled.Single(w => w.WaiterUserId == waiter).Settlement!.Difference);
        Assert.IsType<BadRequestObjectResult>((await Pos(c).SettleWaiter(c.Id, session.Id, new SettleWaiterRequest(waiter, 240m))).Result);

        // The drawer: 50 float + 236 + 4 tip + 236 = 526 expected; 524 counted (the waiter's 2.00).
        var closed = (await Pos(c).CloseSession(c.Id, session.Id, new CloseSessionRequest(new List<CountedTenderRequest> { new(c.Cash, 524m, "Kamarieri") }))).Result;
        Assert.True(closed is OkObjectResult, (closed as BadRequestObjectResult)?.Value?.ToString());
        var entry = ((SessionReportResponse)((OkObjectResult)closed!).Value!).JournalEntryId!.Value;
        var lines = await c.Db.JournalEntryLines.AsNoTracking().Where(l => l.JournalEntryId == entry).ToListAsync();
        decimal Net(string code) => lines.Where(l => l.AccountId == c.Account(code)).Sum(l => l.Debit - l.Credit);
        Assert.Equal(lines.Sum(l => l.Debit), lines.Sum(l => l.Credit));
        Assert.Equal((-10m, 2m, 0m), (Net("240300"), Net("111100"), Net("100900")));
        Assert.Contains(lines, l => l.AccountId == c.Account("111100") && l.EmployeeId != null);
        Assert.Equal(242m, Net("103200"));
    }

    // ---- P4: services ----

    private PosServicesController ServicesApi(Co c) => As(new PosServicesController(c.Db, new AppointmentService(c.Db, new NullStringLocalizer<ErrorMessages>()),
        new PriceListService(c.Db, new StockService(c.Db, new NullStringLocalizer<ErrorMessages>()), new NumberSeriesService(c.Db), new NullStringLocalizer<ErrorMessages>()),
        new Pako.Api.Services.Notifications.NotificationOutbox(c.Db), new NullStringLocalizer<ErrorMessages>()), c.UserId);

    // A salon: Arta works 09:00–17:00; a 30-minute haircut is booked, can't be double-booked or
    // put outside her hours, takes a deposit, is paid at the till (deposit + cash) and earns Arta
    // her commission basis.
    [Fact]
    public async Task Appointments_BookCheckOut_AndCountTowardsCommission()
    {
        var c = await SeedAsync();
        var (store, register) = await SetupAsync(c);
        var deposits = new PaymentMethod { Id = Guid.NewGuid(), CompanyId = c.Id, Name = "Depozita", Kind = PaymentMethodKind.GiftCard, LedgerAccountId = c.Account("240300") };
        c.Db.PaymentMethods.Add(deposits);
        var haircut = new Item { Id = Guid.NewGuid(), CompanyId = c.Id, Code = 600, Name = "Prerje flokësh", Unit = "copë", Type = ItemType.Service,
            DefaultUnitPrice = 10m, DefaultTaxDefinitionId = c.S18, IsBookable = true, DurationMinutes = 30, BufferMinutes = 0 };
        c.Db.Items.Add(haircut);
        var artaUser = Guid.NewGuid();
        var arta = new Pako.Domain.Payroll.Employee { Id = Guid.NewGuid(), CompanyId = c.Id, UserId = artaUser, Name = "Arta" };
        c.Db.Employees.Add(arta);
        await c.Db.SaveChangesAsync();
        var hours = Enumerable.Range(0, 7).Select(d => new ResourceHoursResponse(d, new TimeOnly(9, 0), new TimeOnly(17, 0))).ToList();
        var chair = Ok(await ServicesApi(c).CreateResource(c.Id, new SaveResourceRequest(store.Id, "Arta", ResourceKind.Staff, hours,
            new List<Guid> { haircut.Id }, artaUser)));

        // Tuesday 5 March 2030, 10:00 in Prishtina (09:00 UTC).
        var ten = new DateTime(2030, 3, 5, 9, 0, 0, DateTimeKind.Utc);
        var booked = Ok(await ServicesApi(c).CreateAppointment(c.Id, new SaveAppointmentRequest(store.Id, haircut.Id, chair.Id, ten, "Blerta", Phone: "044111222")));
        Assert.Equal((ten.AddMinutes(30), AppointmentState.Booked), (booked.End, booked.State));
        Assert.IsType<BadRequestObjectResult>((await ServicesApi(c).CreateAppointment(c.Id, new SaveAppointmentRequest(store.Id, haircut.Id, chair.Id,
            ten.AddMinutes(15), "Other"))).Result);
        Assert.IsType<BadRequestObjectResult>((await ServicesApi(c).CreateAppointment(c.Id, new SaveAppointmentRequest(store.Id, haircut.Id, chair.Id,
            new DateTime(2030, 3, 5, 16, 45, 0, DateTimeKind.Utc), "Late"))).Result);
        var free = Ok(await ServicesApi(c).Availability(c.Id, store.Id, haircut.Id, new DateOnly(2030, 3, 5)));
        var starts = Assert.Single(free.Resources).Starts;
        Assert.DoesNotContain(ten, starts);
        Assert.Contains(ten.AddMinutes(30), starts);
        Assert.Equal(new DateTime(2030, 3, 5, 8, 0, 0, DateTimeKind.Utc), starts[0]);

        // A 5.00 deposit loads the appointment's deposit card; checkout spends it.
        var withCard = Ok(await ServicesApi(c).DepositCard(c.Id, booked.Id));
        var session = await OpenAsync(c, register.Id);
        Assert.IsAssignableFrom<ObjectResult>(await Submit(c, new PosOrderRequest(Guid.NewGuid(), session.Id, PosOrderKind.Sale, DateTime.UtcNow,
            new List<PosOrderLineRequest> { new(null, "Depozitë", 1m, 5m, null, GiftCardNumber: withCard.DepositCardNumber) },
            new List<PosPaymentRequest> { new(c.Cash, 5m) })));
        var paid = (PosOrderResponse)Assert.IsAssignableFrom<ObjectResult>(await Submit(c, new PosOrderRequest(Guid.NewGuid(), session.Id, PosOrderKind.Sale,
            DateTime.UtcNow, new List<PosOrderLineRequest> { new(haircut.Id, "Prerje", 1m, 10m, null) },
            new List<PosPaymentRequest> { new(deposits.Id, 5m, Reference: withCard.DepositCardNumber), new(c.Cash, 5m) }, AppointmentId: booked.Id))!).Value!;
        Assert.Equal(10m, paid.Total);
        Assert.Equal(AppointmentState.Completed, (await c.Db.PosAppointments.AsNoTracking().SingleAsync(a => a.Id == booked.Id)).State);
        Assert.Equal(artaUser, (await c.Db.PosOrderLines.AsNoTracking().SingleAsync(l => l.OrderId == paid.Id)).StaffUserId);

        var today = DateOnly.FromDateTime(PosService.LocalTime(DateTime.UtcNow));
        var basis = await new CommissionService(c.Db).BasisAsync(c.Id, arta.Id, Pako.Domain.Payroll.CommissionBasis.PosServicesNet,
            new DateOnly(today.Year, today.Month, 1), new DateOnly(today.Year, today.Month, 1).AddMonths(1).AddDays(-1));
        Assert.Equal(8.47m, Assert.Single(basis).CountedAmount);
    }

    // A package of 10 sessions sold for 80 (8 each) pays two haircuts; memberships start, renew and freeze.
    [Fact]
    public async Task Packages_AndMemberships()
    {
        var c = await SeedAsync();
        var (_, register) = await SetupAsync(c);
        var prepaid = new PaymentMethod { Id = Guid.NewGuid(), CompanyId = c.Id, Name = "Parapagim", Kind = PaymentMethodKind.GiftCard, LedgerAccountId = c.Account("240300") };
        c.Db.PaymentMethods.Add(prepaid);
        var haircut = new Item { Id = Guid.NewGuid(), CompanyId = c.Id, Code = 610, Name = "Prerje", Unit = "copë", Type = ItemType.Service, DefaultUnitPrice = 10m, DefaultTaxDefinitionId = c.S18 };
        var tenCuts = new Item { Id = Guid.NewGuid(), CompanyId = c.Id, Code = 611, Name = "10 prerje", Unit = "copë", Type = ItemType.Service, DefaultUnitPrice = 80m,
            DefaultTaxDefinitionId = c.S18, PackageServiceItemId = haircut.Id, PackageSessions = 10, PackageValidDays = 365 };
        var gym = new Item { Id = Guid.NewGuid(), CompanyId = c.Id, Code = 612, Name = "Palestër mujore", Unit = "muaj", Type = ItemType.Service, DefaultUnitPrice = 25m,
            DefaultTaxDefinitionId = c.S18, MembershipDays = 30 };
        c.Db.Items.AddRange(haircut, tenCuts, gym);
        await c.Db.SaveChangesAsync();
        var session = await OpenAsync(c, register.Id);
        async Task<PosOrderResponse> Sell(PosOrderRequest r)
        {
            var result = Assert.IsAssignableFrom<ObjectResult>(await Submit(c, r));
            Assert.True(result.Value is PosOrderResponse, result.Value?.ToString());
            return (PosOrderResponse)result.Value!;
        }
        PosOrderRequest Order(List<PosOrderLineRequest> lines, List<PosPaymentRequest> payments) =>
            new(Guid.NewGuid(), session.Id, PosOrderKind.Sale, DateTime.UtcNow, lines, payments);

        var sold = await Sell(Order(new List<PosOrderLineRequest> { new(tenCuts.Id, "10 prerje", 1m, 80m, null) }, new List<PosPaymentRequest> { new(c.Cash, 80m) }));
        var number = sold.Lines[0].PackageNumber!;
        Assert.Equal(("PK-00001", "A"), (number, sold.Lines[0].TaxLetter));
        var package = await c.Db.PosPackages.AsNoTracking().SingleAsync();
        Assert.Equal((10, 8m), (package.SessionsTotal, package.UnitValue));

        // Two haircuts from the package: priced at 8, paid by the package, nothing in cash.
        var used = await Sell(Order(new List<PosOrderLineRequest> { new(haircut.Id, "Prerje", 2m, 10m, null, PackageNumber: number) }, new List<PosPaymentRequest>()));
        Assert.Equal((16m, "E"), (used.Total, used.Lines[0].TaxLetter));
        Assert.Equal(2, (await c.Db.PosPackages.AsNoTracking().SingleAsync()).SessionsUsed);
        Assert.IsType<BadRequestObjectResult>(await Submit(c, Order(new List<PosOrderLineRequest> { new(haircut.Id, "Prerje", 9m, 10m, null, PackageNumber: number) },
            new List<PosPaymentRequest>())));
        Assert.IsType<BadRequestObjectResult>(await Submit(c, Order(new List<PosOrderLineRequest> { new(gym.Id, "x", 1m, 25m, null, PackageNumber: number) },
            new List<PosPaymentRequest> { new(c.Cash, 25m) })));

        var joined = await Sell(Order(new List<PosOrderLineRequest> { new(gym.Id, "Palestër", 1m, 25m, null) }, new List<PosPaymentRequest> { new(c.Cash, 25m) }));
        var mb = joined.Lines[0].MembershipNumber!;
        var today = DateOnly.FromDateTime(PosService.LocalTime(DateTime.UtcNow));
        var check = Ok(await ServicesApi(c).Membership(c.Id, mb));
        Assert.Equal((today.AddDays(30), true), (check.EndsOn, check.ActiveToday));
        await Sell(Order(new List<PosOrderLineRequest> { new(gym.Id, "Palestër", 1m, 25m, null, MembershipNumber: mb) }, new List<PosPaymentRequest> { new(c.Cash, 25m) }));
        check = Ok(await ServicesApi(c).Freeze(c.Id, check.Id, new FreezeMembershipRequest(10)));
        Assert.Equal((today.AddDays(70), MembershipState.Frozen, false), (check.EndsOn, check.State, check.ActiveToday));

        var closed = (await Pos(c).CloseSession(c.Id, session.Id, new CloseSessionRequest(new List<CountedTenderRequest>()))).Result;
        Assert.True(closed is OkObjectResult, (closed as BadRequestObjectResult)?.Value?.ToString());
        var entry = ((SessionReportResponse)((OkObjectResult)closed!).Value!).JournalEntryId!.Value;
        var lines = await c.Db.JournalEntryLines.AsNoTracking().Where(l => l.JournalEntryId == entry).ToListAsync();
        // The package: 80 owed, 16 of it used.
        Assert.Equal(-64m, lines.Where(l => l.AccountId == c.Account("240300")).Sum(l => l.Debit - l.Credit));
        Assert.Equal(lines.Sum(l => l.Debit), lines.Sum(l => l.Credit));
    }

    // A phone repair is taken in, estimated, approved, readied (the customer is emailed) and
    // collected at the till.
    [Fact]
    public async Task Repairs_FromIntakeToCollection()
    {
        var c = await SeedAsync();
        var (store, register) = await SetupAsync(c);
        var labour = new Item { Id = Guid.NewGuid(), CompanyId = c.Id, Code = 620, Name = "Punë servisi", Unit = "orë", Type = ItemType.Service,
            DefaultUnitPrice = 20m, DefaultTaxDefinitionId = c.S18 };
        c.Db.Items.Add(labour);
        await c.Db.SaveChangesAsync();
        var ticket = Ok(await ServicesApi(c).CreateRepair(c.Id, new SaveRepairTicketRequest(store.Id, "Besnik", "iPhone 13", "Ekrani i thyer",
            Email: "besnik@example.com", SerialOrPlate: "IMEI-99", Lines: new List<SaveRepairTicketLineRequest> { new(labour.Id, 1.5m) })));
        Assert.Equal(("RP-00001", RepairState.Received, 30m), (ticket.Number, ticket.State, ticket.EstimateTotal));
        Ok(await ServicesApi(c).SetRepairState(c.Id, ticket.Id, new RepairStateRequest(RepairState.Approved)));
        ticket = Ok(await ServicesApi(c).SetRepairState(c.Id, ticket.Id, new RepairStateRequest(RepairState.Ready)));
        Assert.NotNull(ticket.ReadyAt);
        Assert.True(await c.Db.Notifications.AnyAsync(n => n.Template == "RepairStatus" && n.RecipientEmail == "besnik@example.com"));

        var session = await OpenAsync(c, register.Id);
        Assert.IsAssignableFrom<ObjectResult>(await Submit(c, new PosOrderRequest(Guid.NewGuid(), session.Id, PosOrderKind.Sale, DateTime.UtcNow,
            new List<PosOrderLineRequest> { new(labour.Id, "Punë servisi", 1.5m, 20m, null) }, new List<PosPaymentRequest> { new(c.Cash, 30m) }, RepairTicketId: ticket.Id)));
        Assert.Equal(RepairState.Collected, Ok(await ServicesApi(c).Repair(c.Id, ticket.Id)).State);
        Assert.IsType<BadRequestObjectResult>((await ServicesApi(c).SetRepairState(c.Id, ticket.Id, new RepairStateRequest(RepairState.Ready))).Result);
    }

    // Online booking through the store's link: services, free times, a booking on the calendar.
    [Fact]
    public async Task OnlineBooking_ThroughTheStoresLink()
    {
        var c = await SeedAsync();
        var (store, _) = await SetupAsync(c);
        var massage = new Item { Id = Guid.NewGuid(), CompanyId = c.Id, Code = 630, Name = "Masazh", Unit = "copë", Type = ItemType.Service,
            DefaultUnitPrice = 30m, DefaultTaxDefinitionId = c.S18, IsBookable = true, DurationMinutes = 60 };
        c.Db.Items.Add(massage);
        await c.Db.SaveChangesAsync();
        var hours = Enumerable.Range(0, 7).Select(d => new ResourceHoursResponse(d, new TimeOnly(10, 0), new TimeOnly(12, 0))).ToList();
        Ok(await ServicesApi(c).CreateResource(c.Id, new SaveResourceRequest(store.Id, "Dhoma 1", ResourceKind.Room, hours, new List<Guid> { massage.Id })));
        var token = (string)((OkObjectResult)(await ServicesApi(c).BookingLink(c.Id, store.Id)).Result!).Value!;

        var booking = new PublicBookingController(c.Db, new AppointmentService(c.Db, new NullStringLocalizer<ErrorMessages>()),
            new PriceListService(c.Db, new StockService(c.Db, new NullStringLocalizer<ErrorMessages>()), new NumberSeriesService(c.Db), new NullStringLocalizer<ErrorMessages>()),
            new NullStringLocalizer<ErrorMessages>());
        var page = Ok(await booking.Get(token));
        Assert.Equal((30m, 60), (Assert.Single(page.Services).Price!.Value, page.Services[0].DurationMinutes));
        var day = DateOnly.FromDateTime(PosService.LocalTime(DateTime.UtcNow)).AddDays(7);
        var free = Ok(await booking.Availability(token, massage.Id, day));
        // 10:00, 10:15 … 11:00: five starts for an hour inside 10:00–12:00.
        Assert.Equal(5, free.Resources.Single().Starts.Count);
        var booked = Ok(await booking.Book(token, new PublicBookRequest(massage.Id, free.Resources[0].Starts[0], "Vesa", "049123456")));
        Assert.Equal("Dhoma 1", booked.ResourceName);
        Assert.Equal(AppointmentSource.Online, (await c.Db.PosAppointments.AsNoTracking().SingleAsync()).Source);
        // That hour is gone; a bad link finds nothing.
        Assert.Single(Ok(await booking.Availability(token, massage.Id, day)).Resources.Single().Starts);
        Assert.IsType<NotFoundResult>((await booking.Get("nope")).Result);
    }

    // ---- P5: hotel, venues, tickets ----

    private PosHotelController HotelApi(Co c) => As(new PosHotelController(c.Db, Tabs(c),
        new PriceListService(c.Db, new StockService(c.Db, new NullStringLocalizer<ErrorMessages>()), new NumberSeriesService(c.Db), new NullStringLocalizer<ErrorMessages>()),
        new Pako.Api.Hubs.PosNotifier(new NoHub()), new NullStringLocalizer<ErrorMessages>()), c.UserId);

    // A two-night stay: the one double room can't be booked twice; check-in needs the guests; the
    // night audit and check-out post the nights and the tourist tax; a bar tab is charged to the
    // room; the till takes the whole folio in one coupon; check-out leaves the room dirty. A
    // company's stay is billed to it on a draft invoice instead.
    [Fact]
    public async Task Hotel_StayFromBookingToCheckOut()
    {
        var c = await SeedAsync();
        var (store, register) = await SetupAsync(c);
        var exempt = (await c.Db.TaxDefinitions.AsNoTracking().SingleAsync(t => t.CompanyId == c.Id && t.Code == "SEX")).Id;
        var night = new Item { Id = Guid.NewGuid(), CompanyId = c.Id, Code = 700, Name = "Natë — Double", Unit = "natë", Type = ItemType.Service, DefaultUnitPrice = 60m, DefaultTaxDefinitionId = c.S18 };
        var touristTax = new Item { Id = Guid.NewGuid(), CompanyId = c.Id, Code = 701, Name = "Taksa turistike", Unit = "natë", Type = ItemType.Service, DefaultUnitPrice = 1m,
            DefaultTaxDefinitionId = exempt, DefaultRevenueAccountId = c.Account("240300") };
        var beer = new Item { Id = Guid.NewGuid(), CompanyId = c.Id, Code = 702, Name = "Birrë", Unit = "copë", Type = ItemType.Service, DefaultUnitPrice = 2m, DefaultTaxDefinitionId = c.S18 };
        c.Db.Items.AddRange(night, touristTax, beer);
        (await c.Db.PosStores.SingleAsync(s => s.Id == store.Id)).TouristTaxItemId = touristTax.Id;
        await c.Db.SaveChangesAsync();

        var type = Ok(await HotelApi(c).CreateRoomType(c.Id, new SaveRoomTypeRequest(store.Id, "Double", 2, night.Id)));
        var room = Ok(await HotelApi(c).CreateRoom(c.Id, new SaveRoomRequest(type.Id, "101")));
        var today = DateOnly.FromDateTime(PosService.LocalTime(DateTime.UtcNow));
        var booking = Ok(await HotelApi(c).CreateBooking(c.Id, new SaveHotelBookingRequest(store.Id, type.Id, today, today.AddDays(2), "Lirie Gashi", Adults: 2)));
        Assert.Equal((60m, 2, HotelBookingState.Reserved), (booking.NightlyRate, booking.Nights, booking.State));
        Assert.IsType<BadRequestObjectResult>((await HotelApi(c).CreateBooking(c.Id, new SaveHotelBookingRequest(store.Id, type.Id, today.AddDays(1), today.AddDays(3), "Other"))).Result);
        Assert.IsType<BadRequestObjectResult>((await HotelApi(c).CheckIn(c.Id, booking.Id)).Result);
        Ok(await HotelApi(c).UpdateBooking(c.Id, booking.Id, new SaveHotelBookingRequest(store.Id, type.Id, today, today.AddDays(2), "Lirie Gashi", 2, RoomId: room.Id)));
        Assert.IsType<BadRequestObjectResult>((await HotelApi(c).CheckIn(c.Id, booking.Id)).Result);
        Ok(await HotelApi(c).Guests(c.Id, booking.Id, new SaveHotelGuestsRequest(new List<HotelGuestResponse>
        {
            new(Guid.Empty, "Lirie Gashi", "XK", "ID", "1234567890", null, true), new(Guid.Empty, "Hans Müller", "DE", "Pasaportë", "C01X00T47", null, false),
        })));
        booking = Ok(await HotelApi(c).CheckIn(c.Id, booking.Id));
        Assert.Equal(HotelBookingState.CheckedIn, booking.State);

        // Tonight's audit: a night at 60 and tourist tax for 2 adults.
        var folio = Ok(await HotelApi(c).PostNights(c.Id, booking.Id));
        Assert.Equal(62m, folio.Due);
        // A beer at the bar, charged to room 101.
        var barTab = Ok(await TabsApi(c).Open(c.Id, new OpenTabRequest(store.Id)));
        barTab = Ok(await TabsApi(c).AddLines(c.Id, barTab.Id, new AddTabLinesRequest(new List<AddTabLineRequest> { new(beer.Id, 1m) })));
        folio = Ok(await HotelApi(c).ChargeToRoom(c.Id, barTab.Id, booking.Id));
        Assert.Equal(64m, folio.Due);
        Assert.Equal(TabState.Cancelled, Ok(await TabsApi(c).Get(c.Id, barTab.Id)).State);
        Assert.IsType<BadRequestObjectResult>((await HotelApi(c).CheckOut(c.Id, booking.Id)).Result);

        // Check-out: the second night is posted and the till takes the whole stay.
        folio = Ok(await HotelApi(c).PrepareCheckOut(c.Id, booking.Id));
        Assert.Equal(126m, folio.Due);
        var session = await OpenAsync(c, register.Id);
        var paid = (PosOrderResponse)Assert.IsAssignableFrom<ObjectResult>(await Submit(c, new PosOrderRequest(Guid.NewGuid(), session.Id, PosOrderKind.Sale, DateTime.UtcNow,
            folio.Lines.Where(l => l.Remaining > 0).Select(l => new PosOrderLineRequest(null, "", l.Remaining, 0m, null, TabLineId: l.Id)).ToList(),
            new List<PosPaymentRequest> { new(c.Card, 126m) }, TabId: folio.Id))!).Value!;
        Assert.Contains(paid.Taxes, t => t.TaxLetter == "A" && t.Gross == 4m);
        booking = Ok(await HotelApi(c).CheckOut(c.Id, booking.Id));
        Assert.Equal(HotelBookingState.CheckedOut, booking.State);
        Assert.Equal(RoomState.Dirty, (await c.Db.PosRooms.AsNoTracking().SingleAsync(r => r.Id == room.Id)).State);
        var register2 = Ok(await HotelApi(c).GuestRegister(c.Id, store.Id, today, today.AddDays(2), foreignOnly: true));
        Assert.Equal("Hans Müller", Assert.Single(register2).FullName);

        // A company's stay: billed to it on a draft invoice; the folio is then settled.
        var firm = await c.Db.Partners.AsNoTracking().SingleAsync(p => p.Id == c.Customer);
        var stay = Ok(await HotelApi(c).CreateBooking(c.Id, new SaveHotelBookingRequest(store.Id, type.Id, today.AddDays(5), today.AddDays(6), "Agent",
            RoomId: room.Id, CompanyPartnerId: firm.Id, NightlyRate: 55m)));
        Ok(await HotelApi(c).Guests(c.Id, stay.Id, new SaveHotelGuestsRequest(new List<HotelGuestResponse> { new(Guid.Empty, "Agent", "XK", null, null, null, true) })));
        Ok(await HotelApi(c).CheckIn(c.Id, stay.Id));
        var stayFolio = Ok(await HotelApi(c).PrepareCheckOut(c.Id, stay.Id));
        var invoiceId = (Guid)((OkObjectResult)(await HotelApi(c).Invoice(c.Id, stay.Id, new HotelInvoiceRequest(stayFolio.Lines.Select(l => l.Id).ToList()))).Result!).Value!;
        var invoice = await c.Db.Invoices.AsNoTracking().Include(x => x.Lines).SingleAsync(x => x.Id == invoiceId);
        Assert.Equal((firm.Id, Pako.Domain.Invoicing.InvoiceState.Draft, 2), (invoice.PartnerId, invoice.State, invoice.Lines.Count));
        Assert.Equal(HotelBookingState.CheckedOut, Ok(await HotelApi(c).CheckOut(c.Id, stay.Id)).State);
    }

    // A wedding: one event per hall and day; the final headcount puts the menu × guests on the bill;
    // deposits and the rest pay it; then it completes.
    [Fact]
    public async Task Venues_EventBillFromHeadcount()
    {
        var c = await SeedAsync();
        var (store, register) = await SetupAsync(c);
        var menu = new Item { Id = Guid.NewGuid(), CompanyId = c.Id, Code = 710, Name = "Meny dasme", Unit = "person", Type = ItemType.Service, DefaultUnitPrice = 25m, DefaultTaxDefinitionId = c.S18 };
        c.Db.Items.Add(menu);
        c.Db.PaymentMethods.Add(new PaymentMethod { Id = Guid.NewGuid(), CompanyId = c.Id, Name = "Depozita", Kind = PaymentMethodKind.GiftCard, LedgerAccountId = c.Account("240300") });
        await c.Db.SaveChangesAsync();
        var hall = Ok(await HotelApi(c).CreateVenue(c.Id, new SaveVenueRequest(store.Id, "Salla e Madhe", 400)));
        var day = DateOnly.FromDateTime(PosService.LocalTime(DateTime.UtcNow)).AddDays(60);
        var wedding = Ok(await HotelApi(c).CreateEvent(c.Id, new SaveEventBookingRequest(store.Id, hall.Id, day, "Familja Berisha", 250,
            PackageItemId: menu.Id, PricePerGuest: 24m)));
        Assert.IsType<BadRequestObjectResult>((await HotelApi(c).CreateEvent(c.Id, new SaveEventBookingRequest(store.Id, hall.Id, day, "Tjetër", 100))).Result);
        Assert.IsType<BadRequestObjectResult>((await HotelApi(c).CreateEvent(c.Id, new SaveEventBookingRequest(store.Id, hall.Id, day.AddDays(1), "Shumë", 500))).Result);

        wedding = Ok(await HotelApi(c).EventDepositCard(c.Id, wedding.Id));
        var session = await OpenAsync(c, register.Id);
        Assert.IsAssignableFrom<ObjectResult>(await Submit(c, new PosOrderRequest(Guid.NewGuid(), session.Id, PosOrderKind.Sale, DateTime.UtcNow,
            new List<PosOrderLineRequest> { new(null, "Kapar", 1m, 1000m, null, GiftCardNumber: wedding.DepositCardNumber) }, new List<PosPaymentRequest> { new(c.Card, 1000m) })));
        var bill = Ok(await HotelApi(c).FinalGuests(c.Id, wedding.Id, new FinalGuestsRequest(220)));
        Assert.Equal(5280m, bill.Due);
        Assert.IsType<BadRequestObjectResult>((await HotelApi(c).EventState(c.Id, wedding.Id, new EventBookingStateRequest(EventBookingState.Completed))).Result);
        var deposits = await c.Db.PaymentMethods.AsNoTracking().SingleAsync(m => m.CompanyId == c.Id && m.Kind == PaymentMethodKind.GiftCard);
        Assert.IsAssignableFrom<ObjectResult>(await Submit(c, new PosOrderRequest(Guid.NewGuid(), session.Id, PosOrderKind.Sale, DateTime.UtcNow,
            bill.Lines.Select(l => new PosOrderLineRequest(null, "", l.Remaining, 0m, null, TabLineId: l.Id)).ToList(),
            new List<PosPaymentRequest> { new(deposits.Id, 1000m, Reference: wedding.DepositCardNumber), new(c.Card, 4280m) }, TabId: bill.Id)));
        Assert.Equal(EventBookingState.Completed, Ok(await HotelApi(c).EventState(c.Id, wedding.Id, new EventBookingStateRequest(EventBookingState.Completed))).State);
    }

    // A concert with room for 2: the till issues 2 tickets with codes; a third is refused; the door
    // lets each code in once; a sale whose ticket was used can't be returned.
    [Fact]
    public async Task Tickets_SoldScannedOnce()
    {
        var c = await SeedAsync();
        var (store, register) = await SetupAsync(c);
        var ticketItem = new Item { Id = Guid.NewGuid(), CompanyId = c.Id, Code = 720, Name = "Biletë koncert", Unit = "copë", Type = ItemType.Service, DefaultUnitPrice = 15m, DefaultTaxDefinitionId = c.S18 };
        c.Db.Items.Add(ticketItem);
        await c.Db.SaveChangesAsync();
        var concert = Ok(await HotelApi(c).CreateTicketedEvent(c.Id, new SaveTicketedEventRequest(store.Id, "Koncert", DateTime.UtcNow.AddDays(10), 2,
            new List<SaveEventTicketTypeRequest> { new(ticketItem.Id) })));
        var session = await OpenAsync(c, register.Id);
        PosOrderRequest Sell(decimal qty) => new(Guid.NewGuid(), session.Id, PosOrderKind.Sale, DateTime.UtcNow,
            new List<PosOrderLineRequest> { new(ticketItem.Id, "Biletë", qty, 15m, null) }, new List<PosPaymentRequest> { new(c.Cash, 15m * qty) });
        var sale = (PosOrderResponse)Assert.IsAssignableFrom<ObjectResult>(await Submit(c, Sell(2m))!).Value!;
        Assert.Equal(2, sale.Tickets!.Count);
        Assert.IsType<BadRequestObjectResult>(await Submit(c, Sell(1m)));
        Assert.Equal((2, 0), (Ok(await HotelApi(c).TicketedEvents(c.Id)).Single().Sold, Ok(await HotelApi(c).TicketedEvents(c.Id)).Single().Used));

        var code = sale.Tickets[0].Code;
        Assert.Equal("Valid", Ok(await HotelApi(c).Scan(c.Id, concert.Id, new ScanTicketRequest(code))).Result);
        Assert.Equal("AlreadyUsed", Ok(await HotelApi(c).Scan(c.Id, concert.Id, new ScanTicketRequest(code))).Result);
        Assert.Equal("Invalid", Ok(await HotelApi(c).Scan(c.Id, concert.Id, new ScanTicketRequest("NOPE"))).Result);
        Assert.IsType<BadRequestObjectResult>(await Submit(c, new PosOrderRequest(Guid.NewGuid(), session.Id, PosOrderKind.Cancel, DateTime.UtcNow,
            new List<PosOrderLineRequest>(), new List<PosPaymentRequest> { new(c.Cash, 30m) }, OriginalOrderId: sale.Id, Reason: "x")));
        // Returning the unused one voids it.
        Assert.IsAssignableFrom<ObjectResult>(await Submit(c, new PosOrderRequest(Guid.NewGuid(), session.Id, PosOrderKind.Return, DateTime.UtcNow,
            new List<PosOrderLineRequest> { new(ticketItem.Id, "Biletë", 1m, 15m, null, OriginalLineId: sale.Lines[0].Id) },
            new List<PosPaymentRequest> { new(c.Cash, 15m) }, OriginalOrderId: sale.Id, Reason: "Nuk vjen")));
        Assert.Equal("Invalid", Ok(await HotelApi(c).Scan(c.Id, concert.Id, new ScanTicketRequest(sale.Tickets[1].Code))).Result);
    }

    // ---- P7: specialist retail ----

    private static PriceListService PriceService(Co c) =>
        new(c.Db, new StockService(c.Db, new NullStringLocalizer<ErrorMessages>()), new NumberSeriesService(c.Db), new NullStringLocalizer<ErrorMessages>());
    private static PosPharmacyController Pharmacy(Co c) => As(new PosPharmacyController(c.Db, PriceService(c), new NullStringLocalizer<ErrorMessages>()), c.UserId);
    private static PosForecourtController Forecourt(Co c) => As(new PosForecourtController(c.Db, new NullStringLocalizer<ErrorMessages>()), c.UserId);
    private static PosChannelsController Channels(Co c) => As(new PosChannelsController(c.Db, new NullStringLocalizer<ErrorMessages>()), c.UserId);
    private static PublicChannelController PublicChannel(Co c) => As(new PublicChannelController(c.Db, PriceService(c), new NullStringLocalizer<ErrorMessages>()), c.UserId);
    private static PartsController Parts(Co c) => As(new PartsController(c.Db, PriceService(c), new NullStringLocalizer<ErrorMessages>()), c.UserId);

    // An on-account tender (charged to a partner's receivable).
    private static async Task<Guid> OnAccountAsync(Co c)
    {
        var receivable = await c.Db.CompanyAccountDefaults.AsNoTracking().Where(d => d.CompanyId == c.Id).Select(d => d.ReceivableAccountId).FirstAsync();
        var method = new PaymentMethod { Id = Guid.NewGuid(), CompanyId = c.Id, Name = "Në llogari", Kind = PaymentMethodKind.OnAccount, LedgerAccountId = receivable };
        c.Db.PaymentMethods.Add(method);
        await c.Db.SaveChangesAsync();
        return method.Id;
    }

    private static async Task<Partner> PartnerAsync(Co c, string name, bool vendor = false)
    {
        var partner = new Partner { Id = Guid.NewGuid(), CompanyId = c.Id, Name = name, IsCustomer = !vendor, IsVendor = vendor, FiscalNumber = $"81{Random.Shared.Next(1000000, 9999999)}" };
        c.Db.Partners.Add(partner);
        await c.Db.SaveChangesAsync();
        return partner;
    }

    private static async Task<List<Pako.Domain.Ledger.JournalEntryLine>> CloseAsync(Co c, Guid sessionId, decimal cash)
    {
        var closed = (await Pos(c).CloseSession(c.Id, sessionId, new CloseSessionRequest(new List<CountedTenderRequest> { new(c.Cash, cash) }))).Result;
        Assert.True(closed is OkObjectResult, (closed as ObjectResult)?.Value?.ToString());
        var z = (SessionReportResponse)((OkObjectResult)closed!).Value!;
        var lines = await c.Db.JournalEntryLines.AsNoTracking().Where(l => l.JournalEntryId == z.JournalEntryId).ToListAsync();
        Assert.Equal(lines.Sum(l => l.Debit), lines.Sum(l => l.Credit));
        return lines;
    }

    // A prescription-only medicine is dispensed against its prescription line (no more than
    // prescribed, never above the state's price cap); the insurance fund pays its share on account.
    // A controlled medicine's register lists every movement with the prescription behind each sale.
    [Fact]
    public async Task Pharmacy_PrescriptionsPayersCapsAndTheControlledRegister()
    {
        var c = await SeedAsync();
        var medicine = await c.Db.Items.SingleAsync(i => i.Id == c.Laptop);
        (medicine.IsPrescriptionOnly, medicine.IsControlled, medicine.MaxRetailPrice, medicine.ActiveIngredient) = (true, true, 250m, "Tramadol");
        var generic = new Item { Id = Guid.NewGuid(), CompanyId = c.Id, Code = 2, Name = "Tramadol generic", Unit = "copë", Type = ItemType.Goods, ActiveIngredient = "tramadol" };
        c.Db.Items.Add(generic);
        await c.Db.SaveChangesAsync();
        var (store, register) = await SetupAsync(c);
        var session = await OpenAsync(c, register.Id);
        var onAccount = await OnAccountAsync(c);
        var fund = await PartnerAsync(c, "Fondi i Sigurimeve");

        var payer = Ok(await Pharmacy(c).CreatePayer(c.Id, new SavePayerRequest("FSSH", fund.Id, 80m)));
        var rx = Ok(await Pharmacy(c).CreatePrescription(c.Id, new SavePrescriptionRequest(store.Id, "RX-1001", new DateOnly(2026, 10, 20), "Dr. Gashi", "Besa Krasniqi",
            new List<PrescriptionLineRequest> { new(c.Laptop, 2m, "1×2") }, PayerId: payer.Id)));
        Assert.Equal((80m, PrescriptionState.Open), (rx.CoveragePercent, rx.State));
        var rxLine = rx.Lines[0].Id;

        PosOrderRequest Dispense(decimal qty, decimal price, List<PosPaymentRequest> payments, bool withRx = true) =>
            new(Guid.NewGuid(), session.Id, PosOrderKind.Sale, new DateTime(2026, 10, 31, 10, 0, 0, DateTimeKind.Utc),
                new List<PosOrderLineRequest> { new(c.Laptop, "Tramadol", qty, price, null, PrescriptionLineId: withRx ? rxLine : null) }, payments,
                PrescriptionId: withRx ? rx.Id : null);

        // Without the prescription, above the cap, over the fund's share, or more than prescribed: refused.
        Assert.IsType<BadRequestObjectResult>(await Submit(c, Dispense(1m, 236m, new() { new(c.Cash, 236m) }, withRx: false)));
        Assert.IsType<BadRequestObjectResult>(await Submit(c, Dispense(1m, 260m, new() { new(c.Cash, 260m) })));
        Assert.IsType<BadRequestObjectResult>(await Submit(c, Dispense(1m, 236m, new() { new(onAccount, 200m, PartnerId: fund.Id), new(c.Cash, 36m) })));
        Assert.IsType<BadRequestObjectResult>(await Submit(c, Dispense(3m, 236m, new() { new(c.Cash, 708m) })));
        c.Db.ChangeTracker.Clear();
        // 80% of 236 on the fund, the rest in cash.
        var sale = await Submit(c, Dispense(1m, 236m, new() { new(onAccount, 188.80m, PartnerId: fund.Id), new(c.Cash, 47.20m) }));
        Assert.True(sale is ObjectResult { StatusCode: 200 or 201 }, (sale as ObjectResult)?.Value?.ToString());
        rx = Ok(await Pharmacy(c).Prescription(c.Id, rx.Id));
        Assert.Equal((PrescriptionState.PartlyDispensed, 1m, 1m), (rx.State, rx.Lines[0].Dispensed, rx.Lines[0].Remaining));
        // A dispensed prescription can't be edited.
        Assert.IsType<BadRequestObjectResult>((await Pharmacy(c).UpdatePrescription(c.Id, rx.Id, new SavePrescriptionRequest(store.Id, "RX-1001",
            new DateOnly(2026, 10, 20), "Dr. Gashi", "Besa Krasniqi", new List<PrescriptionLineRequest> { new(c.Laptop, 5m) }))).Result);

        var register2 = Ok(await Pharmacy(c).ControlledRegister(c.Id, c.Laptop, new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 31)));
        Assert.Equal((0m, 9m, 2), (register2.Opening, register2.Closing, register2.Rows.Count));
        Assert.Equal(("RX-1001", "Besa Krasniqi", 1m), (register2.Rows[1].PrescriptionNumber, register2.Rows[1].Patient, register2.Rows[1].Out));
        var substitutes = Ok(await Pharmacy(c).Substitutes(c.Id, c.Laptop, store.Id));
        Assert.Equal("Tramadol generic", Assert.Single(substitutes).Name);

        var lines = await CloseAsync(c, session.Id, 97.20m);
        var receivable = await c.Db.CompanyAccountDefaults.AsNoTracking().Where(d => d.CompanyId == c.Id).Select(d => d.ReceivableAccountId).FirstAsync();
        Assert.Equal(188.80m, lines.Where(l => l.AccountId == receivable && l.PartnerId == fund.Id).Sum(l => l.Debit));
    }

    // Agency items: the principal is owed the price less the commission, which alone is revenue.
    // Fuel: a fleet card charges its company (fuel only, up to its limit), nozzles tie sales to the
    // meters. An online order is fiscalised on dispatch with its cash on delivery charged to the
    // courier, until the courier remits it.
    [Fact]
    public async Task Agency_Fuel_FleetCards_AndOnlineOrdersWithCashOnDelivery()
    {
        var c = await SeedAsync();
        var (store, register) = await SetupAsync(c);
        var session = await OpenAsync(c, register.Id);
        var onAccount = await OnAccountAsync(c);
        var operatorCo = await PartnerAsync(c, "Vala", vendor: true);
        var topUp = new Item
        {
            Id = Guid.NewGuid(), CompanyId = c.Id, Code = 3, Name = "Mbushje Vala 20", Unit = "copë", Type = ItemType.Service, DefaultTaxDefinitionId = c.S18,
            AgencyPartnerId = operatorCo.Id, AgencyCommissionPercent = 5m,
        };
        c.Db.Items.Add(topUp);
        await c.Db.SaveChangesAsync();

        var agencySale = (PosOrderResponse)Assert.IsAssignableFrom<ObjectResult>(await Submit(c, new PosOrderRequest(Guid.NewGuid(), session.Id, PosOrderKind.Sale,
            new DateTime(2026, 10, 31, 10, 0, 0, DateTimeKind.Utc), new List<PosOrderLineRequest> { new(topUp.Id, "Top-up", 1m, 20m, null) },
            new List<PosPaymentRequest> { new(c.Cash, 20m) }))!).Value!;
        Assert.Equal((20m, 0m), (agencySale.Total, agencySale.TotalTax));

        // The forecourt: a tank of "laptops" stands in for a fuel grade, one nozzle on pump 1.
        var tank = Ok(await Forecourt(c).CreateTank(c.Id, new SaveTankRequest(store.Id, "T1", c.Laptop, 20000m)));
        var nozzle = Ok(await Forecourt(c).CreateNozzle(c.Id, new SaveNozzleRequest(store.Id, 1, 1, tank.Id)));
        var fleetCo = await PartnerAsync(c, "Transport Sh.p.k.");
        Ok(await Forecourt(c).CreateFleetCard(c.Id, new SaveFleetCardRequest("FC-777", fleetCo.Id, "01-123-AB", null, 300m)));
        PosOrderRequest Fill(Guid itemId, decimal price, List<PosPaymentRequest> payments) =>
            new(Guid.NewGuid(), session.Id, PosOrderKind.Sale, new DateTime(2026, 10, 31, 11, 0, 0, DateTimeKind.Utc),
                new List<PosOrderLineRequest> { new(itemId, "Fill", 1m, price, null, NozzleId: itemId == c.Laptop ? nozzle.Id : null) }, payments, FleetCardNumber: "FC-777");
        // Not fuel, or a partner the card doesn't name: refused.
        Assert.IsType<BadRequestObjectResult>(await Submit(c, Fill(topUp.Id, 20m, new() { new(onAccount, 20m, PartnerId: fleetCo.Id) })));
        Assert.IsType<BadRequestObjectResult>(await Submit(c, Fill(c.Laptop, 236m, new() { new(onAccount, 236m, PartnerId: operatorCo.Id) })));
        c.Db.ChangeTracker.Clear();
        Assert.IsAssignableFrom<ObjectResult>(await Submit(c, Fill(c.Laptop, 236m, new() { new(onAccount, 236m, PartnerId: fleetCo.Id) })));

        // Meters say 1.5 pumped; the till sold 1 (on the session's business day).
        var day = (await c.Db.PosSessions.AsNoTracking().SingleAsync(s => s.Id == session.Id)).BusinessDate;
        var reconciliation = Ok(await Forecourt(c).SaveReadings(c.Id, new SaveMeterReadingsRequest(store.Id, day,
            new List<MeterReadingRequest> { new(nozzle.Id, 1000m, 1001.5m) })));
        var row = Assert.Single(reconciliation.Nozzles);
        Assert.Equal((1.5m, 1m, -0.5m), (row.Pumped, row.Sold, row.Difference));
        // The next shift must start where this one ended.
        Assert.IsType<BadRequestObjectResult>((await Forecourt(c).SaveReadings(c.Id, new SaveMeterReadingsRequest(store.Id, day.AddDays(1),
            new List<MeterReadingRequest> { new(nozzle.Id, 1002m, 1003m) }))).Result);

        // An online order for one, cash on delivery.
        var channel = Ok(await Channels(c).CreateChannel(c.Id, new SaveSalesChannelRequest(store.Id, "Webshop", SalesChannelKind.Webshop)));
        var catalog = (PaginatedResponse<PublicCatalogItem>)Assert.IsType<OkObjectResult>((await PublicChannel(c).Catalog(channel.Token)).Result).Value!;
        Assert.Equal(9m, catalog.Items.Single(i => i.ItemId == c.Laptop).Available);
        var web = new PublicChannelOrderRequest("SHOP-1", "Dren B.", ChannelFulfilment.Delivery, ChannelPayment.CashOnDelivery,
            new List<PublicChannelOrderLine> { new(c.Laptop, 1m, 236m) }, Phone: "+38344111222", Address: "Rr. B, Prizren", City: "Prizren");
        Assert.IsAssignableFrom<ObjectResult>((await PublicChannel(c).CreateOrder(channel.Token, web)).Result);
        // Sent again: the same order.
        Assert.IsType<OkObjectResult>((await PublicChannel(c).CreateOrder(channel.Token, web)).Result);
        var orders = (PaginatedResponse<ChannelOrderResponse>)Assert.IsType<OkObjectResult>((await Channels(c).Orders(c.Id)).Result).Value!;
        var webOrder = Assert.Single(orders.Items);
        Assert.Equal(("WEB-00001", 236m), (webOrder.Number, webOrder.Total));
        catalog = (PaginatedResponse<PublicCatalogItem>)Assert.IsType<OkObjectResult>((await PublicChannel(c).Catalog(channel.Token)).Result).Value!;
        // The open order holds one.
        Assert.Equal(8m, catalog.Items.Single(i => i.ItemId == c.Laptop).Available);

        var courier = await PartnerAsync(c, "Postakos");
        Assert.IsType<BadRequestObjectResult>((await Channels(c).SetState(c.Id, webOrder.Id, new ChannelOrderStateRequest(ChannelOrderState.Ready))).Result);
        Ok(await Channels(c).SetState(c.Id, webOrder.Id, new ChannelOrderStateRequest(ChannelOrderState.Ready, courier.Id, "PK123")));
        var dispatch = await Submit(c, new PosOrderRequest(Guid.NewGuid(), session.Id, PosOrderKind.Sale, new DateTime(2026, 10, 31, 12, 0, 0, DateTimeKind.Utc),
            new List<PosOrderLineRequest> { new(c.Laptop, "Laptop", 1m, 236m, null) }, new List<PosPaymentRequest> { new(onAccount, 236m, PartnerId: courier.Id) },
            ChannelOrderId: webOrder.Id));
        Assert.True(dispatch is ObjectResult { StatusCode: 200 or 201 }, (dispatch as ObjectResult)?.Value?.ToString());
        var cod = (CodReportResponse)Assert.IsType<OkObjectResult>((await Channels(c).Cod(c.Id)).Result).Value!;
        var owed = Assert.Single(cod.Couriers);
        Assert.Equal(("Postakos", 1, 236m), (owed.CourierName, owed.Orders, owed.Amount));
        Assert.Equal(ChannelOrderState.Dispatched, Assert.Single(cod.Orders).State);
        cod = (CodReportResponse)Assert.IsType<OkObjectResult>((await Channels(c).Remit(c.Id, new CodRemittanceRequest(new List<Guid> { webOrder.Id },
            new DateOnly(2026, 11, 3), "POSTA-11/03"))).Result).Value!;
        Assert.Empty(cod.Couriers);

        var lines = await CloseAsync(c, session.Id, 70m);
        var payable = await c.Db.CompanyAccountDefaults.AsNoTracking().Where(d => d.CompanyId == c.Id).Select(d => d.PayableAccountId).FirstAsync();
        Assert.Equal(19m, lines.Where(l => l.AccountId == payable && l.PartnerId == operatorCo.Id).Sum(l => l.Credit - l.Debit));
        var receivable = await c.Db.CompanyAccountDefaults.AsNoTracking().Where(d => d.CompanyId == c.Id).Select(d => d.ReceivableAccountId).FirstAsync();
        Assert.Equal((236m, 236m), (lines.Where(l => l.AccountId == receivable && l.PartnerId == fleetCo.Id).Sum(l => l.Debit),
            lines.Where(l => l.AccountId == receivable && l.PartnerId == courier.Id).Sum(l => l.Debit)));
    }

    // Auto parts: found by any maker's number (spaces and dashes ignored) or by the vehicle.
    [Fact]
    public async Task Parts_SearchByCrossReference_AndByVehicle()
    {
        var c = await SeedAsync();
        Ok(await Parts(c).Save(c.Id, c.Laptop, new SavePartDataRequest(
            new List<CrossReferenceRequest> { new("Bosch", "0 986 452 041"), new("VW", "03C-115-561H") },
            new List<FitmentRequest> { new("Volkswagen", "Golf", 2008, 2013, "1.4 TSI") })));
        var byNumber = Ok(await Parts(c).Search(c.Id, number: "03c115561h", warehouseId: c.Warehouse));
        Assert.Equal(("reference", "VW", 10m), (Assert.Single(byNumber).Match, byNumber[0].Brand, byNumber[0].OnHand));
        Assert.Single(Ok(await Parts(c).Search(c.Id, make: "volkswagen", model: "golf", year: 2010)));
        Assert.Empty(Ok(await Parts(c).Search(c.Id, make: "Volkswagen", model: "Golf", year: 2015)));
    }

    // GS1 DataMatrix on medicine packs: GTIN, expiry, lot and serial.
    [Fact]
    public void Gs1_DataMatrix_IsRead()
    {
        var e = Gs1.Parse("]d2010950123456789017310123" + "10LOT42" + Gs1.GroupSeparator + "21SN0001");
        Assert.NotNull(e);
        Assert.Equal(("09501234567890", "LOT42", new DateOnly(2031, 1, 23), "SN0001"), (e!.Gtin, e.Lot, e.Expiry!.Value, e.Serial));
        Assert.Equal(new DateOnly(2030, 2, 28), Gs1.Parse("0109501234567890173002" + "00")!.Expiry);
        Assert.Contains("9501234567890", Gs1.Candidates("09501234567890"));
        Assert.Null(Gs1.Parse("4006381333931"));
    }
}
