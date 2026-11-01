using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Contracts;
using Pako.Domain.Companies;
using Pako.Domain.Inventory;
using Pako.Domain.Ledger;
using Pako.Domain.Pos;
using Pako.Domain.Tax;
using Pako.Fiscal.Xk;
using Pako.Fiscal.Xk.Atk;
using Pako.Infrastructure;

namespace Pako.Api.Services;

// docs/POS_PLAN.md §11–§14 — the cloud side of the till: sessions and cash, orders (sales, returns,
// cancellations) with their fiscal coupons, the stock they move, and the one journal entry each
// session posts when it closes (D6). Every amount is computed here with PosPricing (D16); what the
// till sends is checked against it.
public class PosService
{
    // Law 08/L-257 Art. 6(11), Minister decision 19/2026: no cash above €2,000 from an individual.
    public const decimal CashLimitB2C = 2000m;
    // AI 01/2026 Art. 44: an offline coupon must reach ATK within 48 hours.
    public static readonly TimeSpan OfflineDeadline = TimeSpan.FromHours(48);

    private readonly PakoDbContext _db;
    private readonly StockService _stock;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public PosService(PakoDbContext db, StockService stock, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _stock = stock;
        _localizer = localizer;
    }

    // Kosovo's clock (CET/CEST): the business day and the coupon's daily number follow it, not UTC.
    private static readonly TimeZoneInfo Kosovo = FindKosovoZone();

    private static TimeZoneInfo FindKosovoZone()
    {
        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById("Europe/Belgrade");
        }
        catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            return TimeZoneInfo.Utc; // an image without tz data
        }
    }

    public static DateTime LocalTime(DateTime utc) => TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), Kosovo);

    public static DateTime UtcFromLocal(DateTime local) =>
        DateTime.SpecifyKind(TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(local, DateTimeKind.Unspecified), Kosovo), DateTimeKind.Utc);

    private PosException Fail(string key, params object[] args) =>
        new(args.Length == 0 ? _localizer[key].Value : string.Format(_localizer[key].Value, args));

    // ---- Sessions ----

    public async Task<PosSession> OpenSessionAsync(Guid companyId, PosRegister register, decimal openingFloat, Guid userId)
    {
        if (!register.IsActive) throw Fail("PosRegisterInactive");
        if (openingFloat < 0) throw Fail("PosAmountInvalid");
        if (await _db.PosSessions.AnyAsync(s => s.RegisterId == register.Id && s.State == PosSessionState.Open)) throw Fail("PosSessionAlreadyOpen");
        var number = (await _db.PosSessions.Where(s => s.RegisterId == register.Id).MaxAsync(s => (int?)s.Number) ?? 0) + 1;
        var session = new PosSession
        {
            Id = Guid.NewGuid(), CompanyId = companyId, RegisterId = register.Id, Number = number, OpenedByUserId = userId,
            OpeningFloat = PosPricing.Money(openingFloat), BusinessDate = DateOnly.FromDateTime(LocalTime(DateTime.UtcNow)),
        };
        _db.PosSessions.Add(session);
        return session;
    }

    public async Task<PosCashMovement> AddCashMovementAsync(Guid companyId, PosSession session, CashMovementRequest request, Guid userId)
    {
        if (session.State != PosSessionState.Open) throw Fail("PosSessionNotOpen");
        if (request.Amount <= 0) throw Fail("PosAmountInvalid");
        if (string.IsNullOrWhiteSpace(request.Reason)) throw Fail("PosReasonRequired");
        if (!await _db.Accounts.AnyAsync(a => a.Id == request.CounterpartAccountId && a.CompanyId == companyId && a.IsActive && a.IsPostable))
        {
            throw Fail("PosAccountInvalid");
        }
        if (request.PartnerId is { } p && !await _db.Partners.AnyAsync(x => x.Id == p && x.CompanyId == companyId)) throw Fail("PosCustomerNotFound");
        var movement = new PosCashMovement
        {
            Id = Guid.NewGuid(), SessionId = session.Id, Kind = request.Kind, Amount = PosPricing.Money(request.Amount),
            Reason = request.Reason.Trim(), CounterpartAccountId = request.CounterpartAccountId, PartnerId = request.PartnerId,
            CreatedByUserId = userId,
        };
        _db.PosCashMovements.Add(movement);
        return movement;
    }

    private static decimal CashDirection(PosCashMovementKind kind) =>
        kind is PosCashMovementKind.FloatIn or PosCashMovementKind.PettyIn ? 1m : -1m;

    // Expected per payment method: sales take money in, returns and cancellations pay it back; the
    // till's cash method also holds the float and the cash movements.
    public async Task<Dictionary<Guid, decimal>> ExpectedAsync(PosSession session, Guid? cashMethodId)
    {
        var payments = await _db.PosPayments.AsNoTracking()
            .Where(p => _db.PosOrders.Any(o => o.Id == p.OrderId && o.SessionId == session.Id))
            .Select(p => new { p.PaymentMethodId, p.Amount, p.Tip, Kind = _db.PosOrders.Where(o => o.Id == p.OrderId).Select(o => o.Kind).First() })
            .ToListAsync();
        // Tips come in with their tender (the staff collect them at the close).
        var expected = payments.GroupBy(p => p.PaymentMethodId)
            .ToDictionary(g => g.Key, g => g.Sum(p => p.Kind == PosOrderKind.Sale ? p.Amount + p.Tip : -p.Amount));
        if (cashMethodId is { } cash)
        {
            var movements = await _db.PosCashMovements.AsNoTracking().Where(m => m.SessionId == session.Id).ToListAsync();
            expected[cash] = expected.GetValueOrDefault(cash) + session.OpeningFloat + movements.Sum(m => CashDirection(m.Kind) * m.Amount);
        }
        return expected;
    }

    public async Task CloseSessionAsync(Company company, PosSession session, PosRegister register, CloseSessionRequest request, Guid userId)
    {
        if (session.State != PosSessionState.Open) throw Fail("PosSessionNotOpen");
        var methods = await _db.PaymentMethods.AsNoTracking().Where(m => m.CompanyId == company.Id).ToDictionaryAsync(m => m.Id);
        var cashMethod = methods.Values.FirstOrDefault(m => m.Kind == PaymentMethodKind.Cash);
        var expected = await ExpectedAsync(session, cashMethod?.Id);
        if (request.Counted.GroupBy(c => c.PaymentMethodId).Any(g => g.Count() > 1)) throw Fail("PosTenderDuplicate");
        var counted = request.Counted.ToDictionary(c => c.PaymentMethodId);
        if (counted.Keys.Any(id => !methods.ContainsKey(id))) throw Fail("PosTenderNotFound");

        foreach (var methodId in expected.Keys.Union(counted.Keys))
        {
            var exp = PosPricing.Money(expected.GetValueOrDefault(methodId));
            // A tender nobody counted is taken as matching (cards and vouchers are settled by others).
            var cnt = counted.TryGetValue(methodId, out var c) ? PosPricing.Money(c.Counted) : exp;
            // Only a drawer count can't be negative; an uncounted tender (a gift-card balance refunded
            // as store credit) may expect less than nothing.
            if (c is not null && cnt < 0) throw Fail("PosAmountInvalid");
            var difference = cnt - exp;
            if (difference != 0 && string.IsNullOrWhiteSpace(c?.DifferenceReason)) throw Fail("PosDifferenceReasonRequired", methods[methodId].Name);
            _db.PosSessionTenders.Add(new PosSessionTender
            {
                Id = Guid.NewGuid(), SessionId = session.Id, PaymentMethodId = methodId, Expected = exp, Counted = cnt,
                Difference = difference, DifferenceReason = difference == 0 ? null : c!.DifferenceReason!.Trim(),
            });
        }
        session.State = PosSessionState.Closed;
        session.ClosedAt = DateTime.UtcNow;
        session.ClosedByUserId = userId;
        await _db.SaveChangesAsync();

        await PostSessionAsync(company, session, register, userId);
        session.ZReportJson = JsonSerializer.Serialize(await ReportAsync(session, register));
    }

    // ---- Orders ----

    public record SubmitResult(PosOrder Order, FiscalDocument Fiscal, bool Duplicate);

    public async Task<SubmitResult> SubmitOrderAsync(Company company, PosRegister register, Store store, PosSession session,
        PosOrderRequest request, Guid userId, string operatorName)
    {
        // D11: a resent order (same ClientUuid) is answered with what was recorded the first time.
        var existing = await _db.PosOrders.Include(o => o.Lines).Include(o => o.Payments)
            .FirstOrDefaultAsync(o => o.CompanyId == company.Id && o.ClientUuid == request.ClientUuid);
        if (existing is not null)
        {
            var doc = await _db.FiscalDocuments.FirstAsync(d => d.OrderId == existing.Id);
            return new SubmitResult(existing, doc, true);
        }

        if (session.RegisterId != register.Id) throw Fail("PosSessionNotOpen");
        // An order rung up offline before the till was retired still has to be recorded.
        if ((!register.IsActive || !store.IsActive) && !request.CreatedOffline) throw Fail("PosRegisterInactive");
        // A late offline order may join a closed session (it is booked as an adjustment); a new one may not.
        if (session.State != PosSessionState.Open && !request.CreatedOffline) throw Fail("PosSessionNotOpen");
        // A cancellation takes the whole original order; its lines need not be sent.
        if (request.Kind != PosOrderKind.Cancel && request.Lines.Count == 0) throw Fail("PosOrderNoLines");

        Partner? customer = null;
        if (request.CustomerId is { } customerId)
        {
            customer = await _db.Partners.AsNoTracking().FirstOrDefaultAsync(p => p.Id == customerId && p.CompanyId == company.Id && p.IsCustomer)
                ?? throw Fail("PosCustomerNotFound");
        }

        // P4: a sale may settle an appointment or collect a repair.
        Appointment? appointment = null;
        RepairTicket? repair = null;
        if (request.AppointmentId is { } appointmentId)
        {
            appointment = await _db.PosAppointments.FirstOrDefaultAsync(a => a.Id == appointmentId && a.CompanyId == company.Id)
                ?? throw Fail("PosAppointmentNotFound");
            if (request.Kind != PosOrderKind.Sale || appointment.State is AppointmentState.Completed or AppointmentState.Cancelled) throw Fail("PosAppointmentClosed");
            if (customer is null && appointment.CustomerId is { } apCustomer) customer = await _db.Partners.AsNoTracking().FirstAsync(p => p.Id == apCustomer);
        }
        if (request.RepairTicketId is { } repairId)
        {
            repair = await _db.PosRepairTickets.FirstOrDefaultAsync(t => t.Id == repairId && t.CompanyId == company.Id) ?? throw Fail("PosRepairNotFound");
            if (request.Kind != PosOrderKind.Sale || repair.State is RepairState.Collected or RepairState.Cancelled) throw Fail("PosRepairClosed");
            if (customer is null && repair.CustomerId is { } rpCustomer) customer = await _db.Partners.AsNoTracking().FirstAsync(p => p.Id == rpCustomer);
        }

        // P2: a sale may collect a customer order (layaway, special order); its customer is the buyer.
        CustomerOrder? collected = null;
        if (request.CustomerOrderId is { } customerOrderId)
        {
            collected = await _db.PosCustomerOrders.FirstOrDefaultAsync(o => o.Id == customerOrderId && o.CompanyId == company.Id)
                ?? throw Fail("CustomerOrderNotFound");
            if (request.Kind != PosOrderKind.Sale || collected.State is not (CustomerOrderState.Open or CustomerOrderState.Ready)) throw Fail("CustomerOrderClosed");
            customer ??= await _db.Partners.AsNoTracking().FirstAsync(p => p.Id == collected.CustomerId);
        }

        // P7: self-checkout lanes only sell, and only for cards (no cash drawer, no returns).
        if (register.Profile == RegisterProfile.SelfCheckout && request.Kind != PosOrderKind.Sale) throw Fail("PosSelfCheckoutSaleOnly");

        // P7: a prescription dispensed, a fleet card charged, an online order fiscalised.
        Prescription? prescription = null;
        if (request.PrescriptionId is { } prescriptionId)
        {
            prescription = await _db.PosPrescriptions.Include(p => p.Lines).FirstOrDefaultAsync(p => p.Id == prescriptionId && p.CompanyId == company.Id)
                ?? throw Fail("PosPrescriptionNotFound");
            if (request.Kind == PosOrderKind.Sale && (prescription.State is PrescriptionState.Dispensed or PrescriptionState.Cancelled
                || prescription.ValidUntil is { } until && until < DateOnly.FromDateTime(LocalTime(request.OrderedAt))))
            {
                throw Fail("PosPrescriptionClosed", prescription.Number);
            }
        }
        FleetCard? fleetCard = null;
        if (!string.IsNullOrWhiteSpace(request.FleetCardNumber))
        {
            fleetCard = await _db.PosFleetCards.AsNoTracking().FirstOrDefaultAsync(c => c.CompanyId == company.Id && c.Number == request.FleetCardNumber.Trim() && c.IsActive)
                ?? throw Fail("PosFleetCardNotFound");
        }
        ChannelOrder? channelOrder = null;
        if (request.ChannelOrderId is { } channelOrderId)
        {
            channelOrder = await _db.PosChannelOrders.FirstOrDefaultAsync(o => o.Id == channelOrderId && o.CompanyId == company.Id && o.StoreId == store.Id)
                ?? throw Fail("PosChannelOrderNotFound");
            if (request.Kind != PosOrderKind.Sale || channelOrder.State is not (ChannelOrderState.New or ChannelOrderState.Accepted or ChannelOrderState.Ready)
                || channelOrder.PosOrderId != null)
            {
                throw Fail("PosChannelOrderClosed", channelOrder.Number);
            }
        }

        PosOrder? original = null;
        if (request.Kind != PosOrderKind.Sale)
        {
            original = await _db.PosOrders.Include(o => o.Lines).Include(o => o.Payments)
                .FirstOrDefaultAsync(o => o.Id == request.OriginalOrderId && o.CompanyId == company.Id && o.Kind == PosOrderKind.Sale)
                ?? throw Fail("PosOriginalOrderNotFound");
            if (original.State == PosOrderState.Cancelled) throw Fail("PosOrderAlreadyCancelled");
            if (string.IsNullOrWhiteSpace(request.Reason)) throw Fail("PosReasonRequired");
        }

        // A return of dispensed medicines gives the quantity back to the prescription it was sold on.
        if (prescription is null && original?.PrescriptionId is { } soldOn)
        {
            prescription = await _db.PosPrescriptions.Include(p => p.Lines).FirstAsync(p => p.Id == soldOn);
        }

        Tab? tab = null;
        if (request.TabId is { } tabId)
        {
            tab = await _db.PosTabs.Include(t => t.Lines).FirstOrDefaultAsync(t => t.Id == tabId && t.CompanyId == company.Id && t.StoreId == store.Id)
                ?? throw Fail("PosTabClosed");
        }
        var built = await BuildLinesAsync(company, request, original, store.Id, LocalTime(request.OrderedAt), tab);
        var lines = built.Lines;
        var pricing = PosPricing.Compute(lines.Select(l => new PosPricing.LineInput(l.Quantity, l.UnitPrice, l.DiscountAmount, l.TaxLetter, l.TaxRate)).ToList());
        for (var i = 0; i < lines.Count; i++)
        {
            (lines[i].Gross, lines[i].Net, lines[i].Tax) = (pricing.Lines[i].Gross, pricing.Lines[i].Net, pricing.Lines[i].Tax);
        }

        // P7 agency items: the commission kept on each line (VAT-inclusive); a return gives back its share.
        foreach (var line in lines.Where(l => l.AgencyPartnerId != null))
        {
            var sold = line.OriginalLineId is { } soldId ? original!.Lines.First(o => o.Id == soldId) : null;
            line.AgencyCommission = sold is not null
                ? PosPricing.Money(sold.AgencyCommission * line.Quantity / sold.Quantity)
                : PosPricing.Money(line.Gross * built.AgencyPercents.GetValueOrDefault(line.Id) / 100m);
        }
        await CheckSpecialistLinesAsync(company, store, request, lines, original, prescription, fleetCard);
        var partnerLimits = await TenderPartnersAsync(lines, original, prescription, fleetCard, channelOrder, pricing.Total);

        var methods = await _db.PaymentMethods.AsNoTracking().Where(m => m.CompanyId == company.Id).ToDictionaryAsync(m => m.Id);
        if (register.Profile == RegisterProfile.SelfCheckout
            && request.Payments.Any(p => methods.TryGetValue(p.PaymentMethodId, out var m) && m.Kind == PaymentMethodKind.Cash))
        {
            throw Fail("PosSelfCheckoutCardOnly");
        }
        // P4: sessions taken from packages are paid from the packages (the prepaid liability); the
        // tenders pay the rest.
        var packageLines = lines.Select((l, i) => (l, i)).Where(x => x.l.PackageNumber != null && x.l.ItemId is { } id && !IsPackageSale(x.l)).ToList();
        var packageGross = packageLines.Sum(x => pricing.Lines[x.i].Gross);
        var payments = BuildPayments(request, methods, pricing.Total - packageGross, customer, allowNoPayments: packageGross > 0, partnerLimits);
        if (packageLines.Count > 0)
        {
            var prepaid = methods.Values.Where(m => m.Kind == PaymentMethodKind.GiftCard).OrderBy(m => m.Name).FirstOrDefault() ?? throw Fail("PosGiftCardNotSetUp");
            foreach (var g in packageLines.GroupBy(x => x.l.PackageNumber!))
            {
                payments.Add(new PosPayment { Id = Guid.NewGuid(), PaymentMethodId = prepaid.Id, Amount = g.Sum(x => pricing.Lines[x.i].Gross), Reference = g.Key });
            }
        }

        var order = new PosOrder
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, ClientUuid = request.ClientUuid, SessionId = session.Id, RegisterId = register.Id,
            StoreId = store.Id, Kind = request.Kind, OrderedAt = DateTime.SpecifyKind(request.OrderedAt, DateTimeKind.Utc),
            OperatorUserId = userId, OperatorName = operatorName, CustomerId = customer?.Id, OriginalOrderId = original?.Id,
            Reason = request.Reason?.Trim(), Total = pricing.Total, TotalTax = pricing.TotalTax, TotalDiscount = pricing.TotalDiscount,
            CreatedOffline = request.CreatedOffline, Lines = lines, Payments = payments,
            CouponCodes = request.CouponCodes is { Count: > 0 } codes ? string.Join(",", codes.Select(c => c.Trim().ToUpperInvariant()).Distinct()) : null,
            Number = $"{register.Code}-{(await _db.PosOrders.CountAsync(o => o.RegisterId == register.Id)) + 1:D5}",
        };
        foreach (var line in order.Lines) line.OrderId = order.Id;
        foreach (var payment in order.Payments) payment.OrderId = order.Id;

        var fiscal = await FiscalizeAsync(company, register, store, order, original, request.Fiscal, methods);
        _db.PosOrders.Add(order);
        _db.FiscalDocuments.Add(fiscal);
        if (request.Kind == PosOrderKind.Cancel) original!.State = PosOrderState.Cancelled;
        if (appointment is not null)
        {
            order.AppointmentId = appointment.Id;
            appointment.State = AppointmentState.Completed;
            appointment.PosOrderId = order.Id;
            // The service is credited to whoever performed it (commission).
            var staff = await _db.PosResources.AsNoTracking().Where(r => r.Id == appointment.ResourceId).Select(r => r.UserId).FirstOrDefaultAsync();
            foreach (var line in order.Lines.Where(l => l.ItemId == appointment.ItemId && l.StaffUserId == null)) line.StaffUserId = staff;
        }
        if (prescription is not null)
        {
            order.PrescriptionId = prescription.Id;
            ApplyPrescription(prescription, order);
        }
        order.FleetCardId = fleetCard?.Id;
        if (channelOrder is not null)
        {
            order.ChannelOrderId = channelOrder.Id;
            channelOrder.PosOrderId = order.Id;
            channelOrder.State = channelOrder.Fulfilment == ChannelFulfilment.Pickup ? ChannelOrderState.Completed : ChannelOrderState.Dispatched;
        }
        if (repair is not null)
        {
            order.RepairTicketId = repair.Id;
            repair.State = RepairState.Collected;
            repair.CollectedOrderId = order.Id;
        }
        await ApplyPackagesAsync(company, order, customer);
        await ApplyTicketsAsync(company, order, original);
        await ApplyMembershipsAsync(company, order, customer);
        if (tab is not null)
        {
            order.TabId = tab.Id;
            TabService.ApplyPayment(tab, order.Lines.Where(l => l.TabLineId != null).Select(l => (l.TabLineId!.Value, l.Quantity)));
        }
        if (collected is not null)
        {
            collected.State = CustomerOrderState.Collected;
            collected.CollectedOrderId = order.Id;
        }
        await ApplyGiftCardsAsync(company, order, methods);
        await ApplySerialsAsync(company, order);
        await ApplyLoyaltyAsync(company, order, request, built.Programs, original);
        await CountProgramUsesAsync(built.Programs);

        await MoveStockAsync(company, store, order, original);

        // A late order for a session already booked posts its own adjustment entry.
        if (session.State == PosSessionState.Posted)
        {
            await _db.SaveChangesAsync();
            await PostOrdersAsync(company, session, register, new[] { order.Id }, userId, adjustment: true);
        }
        return new SubmitResult(order, fiscal, false);
    }

    private record BuiltLines(List<PosOrderLine> Lines, ProgramEngine.Result? Programs, Dictionary<Guid, decimal> AgencyPercents);

    private async Task<BuiltLines> BuildLinesAsync(Company company, PosOrderRequest request, PosOrder? original, Guid storeId, DateTime localNow,
        Tab? tab = null)
    {
        // A cancellation always takes back the whole original order, whatever the till sent.
        var requested = request.Kind == PosOrderKind.Cancel
            ? original!.Lines.OrderBy(l => l.LineNo).Select(l => new PosOrderLineRequest(l.ItemId, l.Description, l.Quantity, l.UnitPrice,
                l.TaxDefinitionId, l.DiscountAmount, null, l.LotNumber, l.Id)).ToList()
            : request.Lines;
        // P3: lines paying a tab take the item, price and discount the tab recorded (the waiter
        // confirmed ages when ordering) and can't pay more than is left of the tab line.
        if (requested.Any(l => l.TabLineId != null))
        {
            if (tab is null || request.Kind != PosOrderKind.Sale || !TabService.IsOpen(tab)) throw Fail("PosTabClosed");
            var paying = new Dictionary<Guid, decimal>();
            requested = requested.Select(l =>
            {
                if (l.TabLineId is not { } tabLineId) return l;
                var line = tab.Lines.FirstOrDefault(x => x.Id == tabLineId && x.State is TabLineState.Pending or TabLineState.Sent)
                    ?? throw Fail("PosTabLineNotFound");
                paying[tabLineId] = paying.GetValueOrDefault(tabLineId) + l.Quantity;
                if (l.Quantity <= 0 || paying[tabLineId] > line.Quantity - line.PaidQuantity) throw Fail("PosTabLineOverpaid", line.Description);
                var description = line.Modifiers is { } m ? $"{line.Description} ({m})" : line.Description;
                return l with { ItemId = line.ItemId, Description = description, UnitPrice = line.UnitPrice, DiscountAmount = TabService.DiscountShare(line, l.Quantity),
                    AgeVerified = true, TaxDefinitionId = null, UnitName = null };
            }).ToList();
        }

        var itemIds = requested.Where(l => l.ItemId != null).Select(l => l.ItemId!.Value).Distinct().ToList();
        var items = await _db.Items.AsNoTracking().Where(i => i.CompanyId == company.Id && itemIds.Contains(i.Id)).ToDictionaryAsync(i => i.Id);
        foreach (var packageItem in items.Values.Where(i => i.PackageServiceItemId != null)) _packageItems.Add(packageItem.Id);
        // P2: a gift card sold at the till loads a prepaid balance — a liability on the gift-card
        // tender's account, outside VAT until it is spent.
        Guid? giftCardAccount = null;
        if (original is null && requested.Any(l => l.GiftCardNumber != null))
        {
            giftCardAccount = await _db.PaymentMethods.AsNoTracking().Where(m => m.CompanyId == company.Id && m.Kind == PaymentMethodKind.GiftCard)
                .OrderBy(m => m.Name).Select(m => (Guid?)m.LedgerAccountId).FirstOrDefaultAsync() ?? throw Fail("PosGiftCardNotSetUp");
        }
        if (items.Count != itemIds.Count) throw Fail("PosItemNotFound");
        var taxIds = requested.Select(l => l.TaxDefinitionId ?? (l.ItemId is { } id ? items[id].DefaultTaxDefinitionId : null))
            .Where(t => t != null).Select(t => t!.Value).Distinct().ToList();
        var taxes = await _db.TaxDefinitions.AsNoTracking().Where(t => t.CompanyId == company.Id && taxIds.Contains(t.Id)).ToDictionaryAsync(t => t.Id);
        // Only active output-VAT codes can go on a coupon: a purchase or reverse-charge code would
        // post sales VAT as deductible input VAT.
        if (taxes.Values.FirstOrDefault(t => !IsSalesVat(t)) is { } wrong) throw Fail("PosTaxNotForSales", wrong.Name);
        var defaults = await _db.CompanyAccountDefaults.AsNoTracking().FirstOrDefaultAsync(d => d.CompanyId == company.Id)
            ?? throw Fail("NoAccountDefaults");

        var returned = original is null ? new Dictionary<Guid, (decimal Quantity, decimal Discount)>() : await ReturnedAsync(original.Id);
        // P4: packages this sale uses sessions of, and the liability package sales load.
        var packageNumbers = original is null ? requested.Where(l => !string.IsNullOrWhiteSpace(l.PackageNumber)).Select(l => l.PackageNumber!.Trim()).Distinct().ToList() : new();
        var packages = packageNumbers.Count == 0 ? new Dictionary<string, CustomerPackage>()
            : await _db.PosPackages.AsNoTracking().Where(p => p.CompanyId == company.Id && packageNumbers.Contains(p.Number)).ToDictionaryAsync(p => p.Number);
        var packageUse = new Dictionary<string, int>();
        Guid? prepaidAccount = giftCardAccount;
        if (original is null && requested.Any(l => l.ItemId is { } id && items[id].PackageServiceItemId != null))
        {
            prepaidAccount ??= await _db.PaymentMethods.AsNoTracking().Where(m => m.CompanyId == company.Id && m.Kind == PaymentMethodKind.GiftCard)
                .OrderBy(m => m.Name).Select(m => (Guid?)m.LedgerAccountId).FirstOrDefaultAsync() ?? throw Fail("PosGiftCardNotSetUp");
        }
        var today = DateOnly.FromDateTime(localNow);
        var result = new List<PosOrderLine>();
        var lineNo = 0;
        foreach (var requestedLine in requested)
        {
            var l = requestedLine;
            if (original is null && l.GiftCardNumber != null)
            {
                if (l.ItemId != null || l.Quantity != 1m || l.UnitPrice <= 0 || l.DiscountAmount != 0) throw Fail("PosAmountInvalid");
                result.Add(new PosOrderLine
                {
                    Id = Guid.NewGuid(), LineNo = ++lineNo, Description = string.IsNullOrWhiteSpace(l.Description) ? "Gift card" : l.Description.Trim(),
                    Unit = "copë", Quantity = 1m, UnitPrice = PosPricing.Money(l.UnitPrice), TaxLetter = TaxLetters.Exempt,
                    RevenueAccountId = giftCardAccount!.Value, GiftCardNumber = l.GiftCardNumber.Trim(),
                });
                continue;
            }
            var item = l.ItemId is { } itemId ? items[itemId] : null;
            var taxId = l.TaxDefinitionId ?? item?.DefaultTaxDefinitionId;
            TaxDefinition? tax = taxId is { } t ? taxes.GetValueOrDefault(t) : null;
            if (company.IsVatRegistered && tax is null) throw Fail("TaxCodeRequired");
            var rate = tax?.Rate ?? 0m;
            var letter = LetterFor(tax) ?? throw Fail("PosTaxNotFiscal", tax!.Name);
            if (StockService.ResolveUnit(item, l.UnitName) is not { } unit) throw Fail("LineUnitUnknown", l.UnitName ?? "");
            if (l.Quantity <= 0 || l.UnitPrice < 0 || l.DiscountAmount < 0) throw Fail("PosAmountInvalid");
            if (original is null && PosPricing.Money(l.DiscountAmount) > PosPricing.Money(l.Quantity * l.UnitPrice)) throw Fail("PosDiscountTooLarge", l.Description);
            if (original is null && item?.IsVariantTemplate == true) throw Fail("PosTemplateNotSold", item.Name);
            // P4: a session taken from a package is priced at the package's value per session.
            if (original is null && !string.IsNullOrWhiteSpace(l.PackageNumber))
            {
                var number = l.PackageNumber.Trim();
                var package = packages.GetValueOrDefault(number);
                if (package is null || !package.IsActive || (package.ExpiresOn is { } until && until < today) || item?.Id != package.ServiceItemId
                    || l.Quantity != decimal.Truncate(l.Quantity))
                {
                    throw Fail("PosPackageInvalid", number);
                }
                packageUse[number] = packageUse.GetValueOrDefault(number) + (int)l.Quantity;
                if (packageUse[number] > package.SessionsTotal - package.SessionsUsed) throw Fail("PosPackageUsedUp", number);
                l = l with { UnitPrice = PosPricing.Money(package.UnitValue), DiscountAmount = 0m };
            }
            // P2: an item that tracks serials sells one unit per line, with its serial number.
            if (original is null && item?.TrackSerials == true && (l.Quantity != 1m || string.IsNullOrWhiteSpace(l.SerialNumber)))
            {
                throw Fail("PosSerialRequired", item.Name);
            }
            // P2: age-restricted goods (alcohol, tobacco) need the cashier's confirmation on the line.
            if (original is null && item?.MinimumAge is > 0 && !l.AgeVerified) throw Fail("PosAgeNotVerified", item.Name, item.MinimumAge);
            // P7: a medicine's state-set maximum retail price (per base unit) can't be exceeded.
            if (original is null && item?.MaxRetailPrice is { } cap && unit.Factor > 0 && l.UnitPrice / unit.Factor > cap)
            {
                throw Fail("PosAbovePriceCap", item.Name, cap);
            }

            if (original is not null)
            {
                var sold = original.Lines.FirstOrDefault(o => o.Id == l.OriginalLineId) ?? throw Fail("PosOriginalLineNotFound");
                // A gift card sold can't come back: its balance may already be spent. Nor can a package
                // or membership (sold or used) — those are settled at the desk, not the till.
                if (sold.GiftCardNumber != null) throw Fail("PosGiftCardNotReturnable");
                if (sold.PackageNumber != null || sold.MembershipNumber != null) throw Fail("PosPackageNotReturnable");
                var (before, discountBefore) = returned.GetValueOrDefault(sold.Id);
                // Returns can't give back more than was sold, less what earlier returns (and earlier
                // lines of this one) took.
                if (request.Kind == PosOrderKind.Return && l.Quantity > sold.Quantity - before) throw Fail("PosReturnTooMuch", sold.Description);
                if (request.Kind == PosOrderKind.Cancel && before > 0) throw Fail("PosCancelAfterReturn");
                // Returned at the price it was sold at (per unit, after its discount). The return that
                // takes the last units takes what is left of the discount, so the parts add up to it.
                var discount = l.Quantity == sold.Quantity - before
                    ? sold.DiscountAmount - discountBefore
                    : PosPricing.Money(sold.DiscountAmount * l.Quantity / sold.Quantity);
                returned[sold.Id] = (before + l.Quantity, discountBefore + discount);
                result.Add(new PosOrderLine
                {
                    Id = Guid.NewGuid(), LineNo = ++lineNo, ItemId = sold.ItemId, Description = sold.Description, Unit = sold.Unit,
                    Quantity = l.Quantity, UnitFactor = sold.UnitFactor, UnitPrice = sold.UnitPrice,
                    DiscountAmount = discount,
                    TaxDefinitionId = sold.TaxDefinitionId, TaxLetter = sold.TaxLetter, TaxRate = sold.TaxRate,
                    RevenueAccountId = sold.RevenueAccountId, LotNumber = sold.LotNumber, OriginalLineId = sold.Id, SerialNumber = sold.SerialNumber,
                    PrescriptionLineId = sold.PrescriptionLineId, NozzleId = sold.NozzleId, AgencyPartnerId = sold.AgencyPartnerId,
                });
                continue;
            }

            // P4: a package sold is a prepaid liability, outside VAT until its sessions are used.
            var sellsPackage = original is null && item?.PackageServiceItemId != null;
            // P7: an agency item is sold in the principal's name: outside our VAT, the commission is ours.
            var agency = item?.AgencyPartnerId;
            if (sellsPackage && l.Quantity != decimal.Truncate(l.Quantity)) throw Fail("PosAmountInvalid");
            result.Add(new PosOrderLine
            {
                Id = Guid.NewGuid(), LineNo = ++lineNo, ItemId = item?.Id, Description = string.IsNullOrWhiteSpace(l.Description) ? item?.Name ?? "?" : l.Description.Trim(),
                Unit = unit.Name ?? item?.Unit ?? "copë", Quantity = l.Quantity, UnitFactor = unit.Factor, UnitPrice = l.UnitPrice,
                DiscountAmount = PosPricing.Money(l.DiscountAmount), TaxDefinitionId = sellsPackage || agency != null ? null : tax?.Id,
                TaxLetter = sellsPackage || agency != null ? TaxLetters.Exempt : letter, TaxRate = sellsPackage || agency != null ? 0m : rate,
                AgencyPartnerId = agency, PrescriptionLineId = l.PrescriptionLineId, NozzleId = l.NozzleId,
                RevenueAccountId = sellsPackage ? prepaidAccount!.Value : item?.DefaultRevenueAccountId ?? defaults.RevenueAccountId,
                PackageNumber = string.IsNullOrWhiteSpace(l.PackageNumber) ? null : l.PackageNumber.Trim(),
                MembershipNumber = item?.MembershipDays is > 0 ? (string.IsNullOrWhiteSpace(l.MembershipNumber) ? "" : l.MembershipNumber.Trim()) : null,
                StaffUserId = l.StaffUserId,
                LotNumber = string.IsNullOrWhiteSpace(l.LotNumber) ? null : l.LotNumber.Trim(),
                AgeVerified = l.AgeVerified,
                TabLineId = l.TabLineId,
                SerialNumber = string.IsNullOrWhiteSpace(l.SerialNumber) ? null : l.SerialNumber.Trim(),
            });
        }

        // P3: a line paying a tab brings the modifiers chosen there (their recipe changes).
        if (tab is not null)
        {
            foreach (var line in result.Where(l => l.TabLineId != null)) line.ModifierIds = tab.Lines.First(t => t.Id == line.TabLineId).ModifierIds;
        }

        // P2: every unit of an item with a deposit (bottle, crate) carries its deposit line.
        if (original is null && request.Kind == PosOrderKind.Sale)
        {
            foreach (var group in result.Where(l => l.ItemId is { } id && items[id].DepositItemId != null)
                         .GroupBy(l => items[l.ItemId!.Value].DepositItemId!.Value))
            {
                var deposits = result.Where(l => l.ItemId == group.Key).Sum(l => l.Quantity);
                if (deposits < group.Sum(l => l.Quantity)) throw Fail("PosDepositMissing", group.First().Description);
            }
        }

        // P2: promotions, coupons and loyalty redemption on a sale (returns keep the sale's prices).
        ProgramEngine.Result? programs = null;
        if (original is null && request.Kind == PosOrderKind.Sale)
        {
            var active = await _db.PosPrograms.AsNoTracking().Include(p => p.Targets)
                .Where(p => p.CompanyId == company.Id && p.IsActive).ToListAsync();
            if (active.Count > 0)
            {
                programs = ProgramEngine.Apply(result.Select(l => new ProgramEngine.Line(l.ItemId,
                        l.ItemId is { } id ? items[id].CategoryId : null, l.Quantity, l.GiftCardNumber != null || l.PackageNumber != null ? 0m : l.UnitPrice,
                        l.DiscountAmount)).ToList(),
                    active, new ProgramEngine.Context(localNow, storeId, request.CouponCodes ?? new List<string>(), request.RedeemPoints));
                for (var i = 0; i < result.Count; i++)
                {
                    result[i].ProgramDiscount = programs.Discounts[i];
                    result[i].ProgramId = programs.ProgramIds[i];
                    result[i].DiscountAmount += programs.Discounts[i];
                }
            }
            else if (request.RedeemPoints > 0)
            {
                throw Fail("PosLoyaltyNotSetUp");
            }
        }
        var agencyPercents = result.Where(l => l.AgencyPartnerId != null && l.OriginalLineId == null && l.ItemId is { } id)
            .ToDictionary(l => l.Id, l => items[l.ItemId!.Value].AgencyCommissionPercent ?? 0m);
        return new BuiltLines(result, programs, agencyPercents);
    }

    // The basket priced exactly as SubmitOrderAsync will price it. Cash given beyond what is due
    // becomes change.
    public async Task<PosQuoteResponse> QuoteAsync(Company company, Store store, PosQuoteRequest request)
    {
        if (request.Lines.Count == 0) return new PosQuoteResponse(new(), new(), 0m, 0m, 0m, 0m, 0m, 0m, false);
        PosOrder? original = null;
        if (request.OriginalOrderId is { } originalId)
            original = await _db.PosOrders.AsNoTracking().Include(o => o.Lines)
                .FirstOrDefaultAsync(o => o.Id == originalId && o.CompanyId == company.Id && o.Kind == PosOrderKind.Sale)
                ?? throw Fail("PosOriginalOrderNotFound");
        var asOrder = new PosOrderRequest(Guid.Empty, Guid.Empty, original is null ? PosOrderKind.Sale : PosOrderKind.Return, DateTime.UtcNow, request.Lines, new(),
            CouponCodes: request.CouponCodes, LoyaltyCardNumber: request.LoyaltyCardNumber, RedeemPoints: request.RedeemPoints, TabId: request.TabId);
        var tab = request.TabId is { } tabId
            ? await _db.PosTabs.AsNoTracking().Include(t => t.Lines).FirstOrDefaultAsync(t => t.Id == tabId && t.CompanyId == company.Id)
            : null;
        var card = await LoyaltyCardAsync(company.Id, request.LoyaltyCardNumber);
        if (request.RedeemPoints > 0 && card is null) throw Fail("PosLoyaltyCardNotFound");
        var built = await BuildLinesAsync(company, asOrder, original, store.Id, LocalTime(DateTime.UtcNow), tab);
        var lines = built.Lines;
        if (card is not null && built.Programs?.PointsRedeemed > card.Points) throw Fail("PosLoyaltyPointsShort", card.Points);
        var pricing = PosPricing.Compute(lines.Select(l => new PosPricing.LineInput(l.Quantity, l.UnitPrice, l.DiscountAmount, l.TaxLetter, l.TaxRate)).ToList());
        var methods = await _db.PaymentMethods.AsNoTracking().Where(m => m.CompanyId == company.Id).ToDictionaryAsync(m => m.Id);
        var payments = request.Payments ?? new();
        if (payments.Any(p => !methods.ContainsKey(p.PaymentMethodId))) throw Fail("PosTenderNotFound");
        // A tip rides on its tender but doesn't pay the order.
        var paid = payments.Sum(p => PosPricing.Money(p.Tendered ?? p.Amount + p.Tip) - PosPricing.Money(p.Tip));
        var cash = payments.Where(p => methods[p.PaymentMethodId].Kind == PaymentMethodKind.Cash).Sum(p => PosPricing.Money(p.Amount));
        // P4: sessions taken from packages are paid by the packages.
        paid += lines.Select((l, i) => (l, i)).Where(x => x.l.PackageNumber != null && !IsPackageSale(x.l)).Sum(x => pricing.Lines[x.i].Gross);
        var names = (built.Programs?.Applied ?? new List<ProgramEngine.Applied>()).ToDictionary(a => a.ProgramId, a => a.Name);

        // P7: the partner shares, priced like the sale will be.
        for (var i = 0; i < lines.Count; i++) lines[i].Gross = pricing.Lines[i].Gross;
        var prescription = request.PrescriptionId is { } rxId
            ? await _db.PosPrescriptions.AsNoTracking().FirstOrDefaultAsync(p => p.Id == rxId && p.CompanyId == company.Id) : null;
        var fleetCard = string.IsNullOrWhiteSpace(request.FleetCardNumber) ? null
            : await _db.PosFleetCards.AsNoTracking().FirstOrDefaultAsync(c => c.CompanyId == company.Id && c.Number == request.FleetCardNumber.Trim() && c.IsActive);
        var channelOrder = request.ChannelOrderId is { } coId
            ? await _db.PosChannelOrders.AsNoTracking().FirstOrDefaultAsync(o => o.Id == coId && o.CompanyId == company.Id) : null;
        var limits = original is null ? await TenderPartnersAsync(lines, null, prescription, fleetCard, channelOrder, pricing.Total) : new();
        var partnerNames = await _db.Partners.AsNoTracking().Where(p => limits.Keys.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.Name);

        return new PosQuoteResponse(pricing.Lines.Select((l, i) => new PosQuoteLineResponse(lines[i].TaxLetter, l.Gross, l.Net, l.Tax,
                lines[i].ProgramDiscount, lines[i].ProgramId is { } pid ? names.GetValueOrDefault(pid) : null)).ToList(),
            pricing.Taxes.Select(t => new ReportTaxRow(t.TaxLetter, t.TaxRate, t.Gross, t.Net, t.Tax)).ToList(),
            pricing.Total, pricing.TotalTax, pricing.TotalDiscount, paid, Math.Max(0m, pricing.Total - paid), Math.Max(0m, paid - pricing.Total),
            cash > CashLimitB2C,
            built.Programs?.Applied.Select(a => new AppliedProgramResponse(a.ProgramId, a.Name, a.Discount)).ToList(),
            built.Programs?.UnusedCodes.ToList(), built.Programs?.PointsRedeemed ?? 0m,
            card is null ? null : new LoyaltyCardResponse(card.Id, card.Number, card.HolderName, card.Phone, card.PartnerId, card.Points, card.IsActive),
            limits.Select(l => new PosTenderPartnerResponse(l.Key, partnerNames.GetValueOrDefault(l.Key) ?? "?", l.Value)).ToList());
    }

    private async Task<LoyaltyCard?> LoyaltyCardAsync(Guid companyId, string? number)
    {
        if (string.IsNullOrWhiteSpace(number)) return null;
        var key = number.Trim();
        return await _db.LoyaltyCards.FirstOrDefaultAsync(c => c.CompanyId == companyId && c.Number == key && c.IsActive)
            ?? throw Fail("PosLoyaltyCardNotFound");
    }

    // P2: loyalty points earned or given back, and redeemed (the card is locked by the company lock
    // every order takes).
    private async Task ApplyLoyaltyAsync(Company company, PosOrder order, PosOrderRequest request, ProgramEngine.Result? programs, PosOrder? original)
    {
        var card = await LoyaltyCardAsync(company.Id, request.LoyaltyCardNumber);
        if (card is null && original?.LoyaltyCardId is { } originalCard)
        {
            card = await _db.LoyaltyCards.FirstOrDefaultAsync(c => c.Id == originalCard);
        }
        if (card is null)
        {
            if (request.RedeemPoints > 0) throw Fail("PosLoyaltyCardNotFound");
            return;
        }
        var loyalty = await _db.PosPrograms.AsNoTracking()
            .FirstOrDefaultAsync(p => p.CompanyId == company.Id && p.Kind == ProgramKind.Loyalty && p.IsActive);
        var redeemed = programs?.PointsRedeemed ?? 0m;
        if (redeemed > card.Points) throw Fail("PosLoyaltyPointsShort", card.Points);
        var earned = loyalty is null ? 0m : ProgramEngine.PointsFor(loyalty, order.Total);
        // A return or cancellation takes back the points its amount earned (never below zero).
        if (order.Kind != PosOrderKind.Sale) earned = -Math.Min(earned, card.Points);
        card.Points += earned - redeemed;
        order.LoyaltyCardId = card.Id;
        order.PointsEarned = earned;
        order.PointsRedeemed = redeemed;
    }

    // P2: gift cards sold load their card; gift-card tenders spend a card on a sale and, on a return
    // or cancellation, refund to it (a new store-credit card when none is named).
    private async Task ApplyGiftCardsAsync(Company company, PosOrder order, Dictionary<Guid, PaymentMethod> methods)
    {
        async Task<GiftCard> Card(string? number, GiftCardKind kind, bool create)
        {
            var key = number?.Trim();
            if (!string.IsNullOrEmpty(key))
            {
                var found = await _db.GiftCards.FirstOrDefaultAsync(c => c.CompanyId == company.Id && c.Number == key);
                if (found is not null) return found;
                if (!create) throw Fail("PosGiftCardNotFound", key);
            }
            else if (!create) throw Fail("PosGiftCardNotFound", "");
            var card = new GiftCard { Id = Guid.NewGuid(), CompanyId = company.Id, Number = string.IsNullOrEmpty(key) ? NewCardNumber() : key, Kind = kind,
                PartnerId = order.CustomerId };
            _db.GiftCards.Add(card);
            return card;
        }

        void Move(GiftCard card, decimal amount)
        {
            card.Balance += amount;
            _db.GiftCardMovements.Add(new GiftCardMovement { Id = Guid.NewGuid(), GiftCardId = card.Id, OrderId = order.Id, Amount = amount });
        }

        foreach (var line in order.Lines.Where(l => l.GiftCardNumber != null))
        {
            var card = await Card(line.GiftCardNumber, GiftCardKind.GiftCard, create: true);
            if (!card.IsActive) throw Fail("PosGiftCardNotFound", card.Number);
            line.GiftCardNumber = card.Number;
            Move(card, line.Gross);
        }
        var today = DateOnly.FromDateTime(LocalTime(order.OrderedAt));
        var packageRefs = order.Lines.Where(l => l.PackageNumber != null).Select(l => l.PackageNumber!).ToHashSet();
        foreach (var payment in order.Payments.Where(p => methods[p.PaymentMethodId].Kind == PaymentMethodKind.GiftCard && !(p.Reference is { } r && packageRefs.Contains(r))))
        {
            if (order.Kind == PosOrderKind.Sale)
            {
                var card = await Card(payment.Reference, GiftCardKind.GiftCard, create: false);
                if (!card.IsActive || card.ExpiresOn is { } expiry && expiry < today) throw Fail("PosGiftCardNotFound", card.Number);
                if (card.Balance < payment.Amount) throw Fail("PosGiftCardBalance", card.Number, card.Balance);
                Move(card, -payment.Amount);
            }
            else
            {
                var card = await Card(payment.Reference, GiftCardKind.StoreCredit, create: true);
                payment.Reference = card.Number;
                Move(card, payment.Amount);
            }
        }
    }

    // P2: a serial sold is registered with its warranty; one returned is marked so (it can be sold
    // again). A serial already sold can't be sold twice.
    private async Task ApplySerialsAsync(Company company, PosOrder order)
    {
        var lines = order.Lines.Where(l => l.SerialNumber != null && l.ItemId != null).ToList();
        if (lines.Count == 0) return;
        var itemIds = lines.Select(l => l.ItemId!.Value).Distinct().ToList();
        var items = await _db.Items.AsNoTracking().Where(i => itemIds.Contains(i.Id)).ToDictionaryAsync(i => i.Id);
        var soldOn = LocalTime(order.OrderedAt);
        foreach (var line in lines)
        {
            var item = items[line.ItemId!.Value];
            var serial = await _db.ItemSerials.FirstOrDefaultAsync(s => s.CompanyId == company.Id && s.ItemId == item.Id && s.Serial == line.SerialNumber);
            if (order.Kind == PosOrderKind.Sale)
            {
                if (lines.Count(l => l.ItemId == item.Id && l.SerialNumber == line.SerialNumber) > 1 || serial?.Status == ItemSerialStatus.Sold)
                {
                    throw Fail("PosSerialSold", line.SerialNumber!);
                }
                if (serial is null)
                {
                    serial = new ItemSerial { Id = Guid.NewGuid(), CompanyId = company.Id, ItemId = item.Id, Serial = line.SerialNumber! };
                    _db.ItemSerials.Add(serial);
                }
                serial.Status = ItemSerialStatus.Sold;
                serial.SoldOrderId = order.Id;
                serial.SoldAt = order.OrderedAt;
                serial.WarrantyUntil = item.WarrantyMonths is { } months ? DateOnly.FromDateTime(soldOn).AddMonths(months) : null;
            }
            else if (serial is not null)
            {
                serial.Status = ItemSerialStatus.Returned;
            }
        }
    }

    // P4: a package-sale line is one whose item sells a package (it gets its number on recording).
    private bool IsPackageSale(PosOrderLine line) => _packageItems.Contains(line.ItemId ?? Guid.Empty);
    private readonly HashSet<Guid> _packageItems = new();

    // P4: package sessions used, and packages sold (one per line, numbered PK-…).
    private async Task ApplyPackagesAsync(Company company, PosOrder order, Partner? customer)
    {
        foreach (var g in order.Lines.Where(l => l.PackageNumber != null && !IsPackageSale(l)).GroupBy(l => l.PackageNumber!))
        {
            var package = await _db.PosPackages.FirstAsync(p => p.CompanyId == company.Id && p.Number == g.Key);
            package.SessionsUsed += (int)g.Sum(l => l.Quantity);
        }
        var sold = order.Lines.Where(IsPackageSale).ToList();
        if (sold.Count == 0) return;
        var items = await _db.Items.AsNoTracking().Where(i => sold.Select(l => l.ItemId).Contains(i.Id)).ToDictionaryAsync(i => i.Id);
        var count = await _db.PosPackages.CountAsync(p => p.CompanyId == company.Id);
        var today = DateOnly.FromDateTime(LocalTime(order.OrderedAt));
        foreach (var line in sold)
        {
            var item = items[line.ItemId!.Value];
            var sessions = item.PackageSessions!.Value * (int)line.Quantity;
            var package = new CustomerPackage
            {
                Id = Guid.NewGuid(), CompanyId = company.Id, Number = $"PK-{++count:D5}", ServiceItemId = item.PackageServiceItemId!.Value,
                CustomerId = customer?.Id, HolderName = customer?.Name, SessionsTotal = sessions,
                UnitValue = Math.Round(line.Gross / sessions, 4, MidpointRounding.AwayFromZero),
                ExpiresOn = item.PackageValidDays is > 0 ? today.AddDays(item.PackageValidDays.Value) : null, SoldOrderId = order.Id,
            };
            _db.PosPackages.Add(package);
            line.PackageNumber = package.Number;
        }
    }

    // P4: a membership plan sold starts a membership (MB-…) or extends the one named, from its end
    // (or today, if it has lapsed).
    private async Task ApplyMembershipsAsync(Company company, PosOrder order, Partner? customer)
    {
        var lines = order.Lines.Where(l => l.MembershipNumber != null && order.Kind == PosOrderKind.Sale).ToList();
        if (lines.Count == 0) return;
        var items = await _db.Items.AsNoTracking().Where(i => lines.Select(l => l.ItemId).Contains(i.Id)).ToDictionaryAsync(i => i.Id);
        var today = DateOnly.FromDateTime(LocalTime(order.OrderedAt));
        var count = await _db.PosMemberships.CountAsync(m => m.CompanyId == company.Id);
        foreach (var line in lines)
        {
            var days = items[line.ItemId!.Value].MembershipDays!.Value * (int)Math.Max(1m, decimal.Truncate(line.Quantity));
            CustomerMembership membership;
            if (line.MembershipNumber!.Length > 0)
            {
                membership = await _db.PosMemberships.FirstOrDefaultAsync(m => m.CompanyId == company.Id && m.Number == line.MembershipNumber)
                    ?? throw Fail("PosMembershipNotFound", line.MembershipNumber);
                if (membership.State == MembershipState.Cancelled) throw Fail("PosMembershipNotFound", line.MembershipNumber);
                membership.EndsOn = (membership.EndsOn >= today ? membership.EndsOn : today).AddDays(days);
                membership.State = MembershipState.Active;
            }
            else
            {
                membership = new CustomerMembership
                {
                    Id = Guid.NewGuid(), CompanyId = company.Id, Number = $"MB-{++count:D5}", PlanItemId = line.ItemId!.Value, CustomerId = customer?.Id,
                    HolderName = customer?.Name, StartsOn = today, EndsOn = today.AddDays(days), State = MembershipState.Active,
                };
                _db.PosMemberships.Add(membership);
                line.MembershipNumber = membership.Number;
            }
            membership.LastOrderId = order.Id;
        }
    }

    // P5: a ticket item of an upcoming event issues one ticket (a QR code) per unit sold, within the
    // event's capacity and the type's quota; returning or cancelling the sale voids unused tickets.
    private async Task ApplyTicketsAsync(Company company, PosOrder order, PosOrder? original)
    {
        if (order.Kind != PosOrderKind.Sale)
        {
            if (original is null) return;
            var returnedItems = order.Lines.Where(l => l.ItemId != null).GroupBy(l => l.ItemId!.Value).ToDictionary(g => g.Key, g => (int)g.Sum(l => l.Quantity));
            foreach (var (itemId, count) in returnedItems)
            {
                var tickets = await _db.PosTickets.Where(t => t.OrderId == original.Id && t.ItemId == itemId && t.State == TicketState.Valid)
                    .OrderByDescending(t => t.CreatedAt).Take(count).ToListAsync();
                var issued = await _db.PosTickets.CountAsync(t => t.OrderId == original.Id && t.ItemId == itemId);
                if (issued > 0 && tickets.Count < count) throw Fail("PosTicketUsed");
                foreach (var t in tickets) t.State = TicketState.Cancelled;
            }
            return;
        }
        var itemIds = order.Lines.Where(l => l.ItemId != null).Select(l => l.ItemId!.Value).Distinct().ToList();
        var now = DateTime.UtcNow;
        var types = await _db.PosEventTicketTypes.AsNoTracking()
            .Where(t => itemIds.Contains(t.ItemId) && _db.PosTicketedEvents.Any(e => e.Id == t.EventId && e.CompanyId == company.Id && e.IsActive && e.StartsAt > now.AddHours(-12)))
            .ToListAsync();
        foreach (var type in types)
        {
            var count = order.Lines.Where(l => l.ItemId == type.ItemId).Sum(l => l.Quantity);
            if (count != decimal.Truncate(count)) throw Fail("PosAmountInvalid");
            var ev = await _db.PosTicketedEvents.AsNoTracking().FirstAsync(e => e.Id == type.EventId);
            var sold = await _db.PosTickets.CountAsync(t => t.EventId == ev.Id && t.State != TicketState.Cancelled);
            var soldOfType = await _db.PosTickets.CountAsync(t => t.EventId == ev.Id && t.ItemId == type.ItemId && t.State != TicketState.Cancelled);
            if (sold + count > ev.Capacity || (type.Quota is { } quota && soldOfType + count > quota)) throw Fail("PosTicketsSoldOut", ev.Name);
            for (var i = 0; i < count; i++)
            {
                _db.PosTickets.Add(new Ticket
                {
                    Id = Guid.NewGuid(), CompanyId = company.Id, EventId = ev.Id, ItemId = type.ItemId, Code = Controllers.PosHotelController.NewTicketCode(),
                    OrderId = order.Id, State = TicketState.Valid,
                });
            }
        }
    }

    // Coupons and capped promotions count their uses.
    private async Task CountProgramUsesAsync(ProgramEngine.Result? programs)
    {
        if (programs is null || programs.Applied.Count == 0) return;
        var ids = programs.Applied.Select(a => a.ProgramId).ToList();
        foreach (var program in await _db.PosPrograms.Where(p => ids.Contains(p.Id) && (p.Kind == ProgramKind.Coupon || p.MaxUses != null)).ToListAsync())
        {
            program.Uses++;
        }
    }

    private static string NewCardNumber() => string.Concat(Enumerable.Range(0, 16).Select(_ => (char)('0' + RandomNumberGenerator.GetInt32(10))));

    // Exempt (letter A) vs zero-rated (C): PAKO's exempt codes carry no deduction right and an
    // "exempt" name/code (SEX, BEX, IEX).
    private static bool IsExempt(TaxDefinition tax) => tax.Rate == 0 && (tax.Code?.Contains("EX") ?? false) && tax.Code != "SEXP";

    // The ATK tax letter of a VAT code, the same for the catalogue, the order and the coupon; null
    // when the rate has no letter.
    public static string? LetterFor(TaxDefinition? tax)
    {
        try
        {
            return TaxLetters.For(tax?.Rate ?? 0m, exempt: tax is null || IsExempt(tax));
        }
        catch (FiscalCouponException)
        {
            return null;
        }
    }

    public static bool IsSalesVat(TaxDefinition tax) =>
        tax.IsActive && tax.Scope != TaxScope.Purchase && tax.Type != TaxType.Withholding && !tax.IsReverseCharge
        && tax.Direction is null or TaxDirection.Out or TaxDirection.None;

    private async Task<Dictionary<Guid, (decimal Quantity, decimal Discount)>> ReturnedAsync(Guid originalOrderId) =>
        await _db.PosOrderLines.AsNoTracking()
            .Where(l => l.OriginalLineId != null && _db.PosOrders.Any(o => o.Id == l.OrderId && o.OriginalOrderId == originalOrderId))
            .GroupBy(l => l.OriginalLineId!.Value).Select(g => new { g.Key, Quantity = g.Sum(l => l.Quantity), Discount = g.Sum(l => l.DiscountAmount) })
            .ToDictionaryAsync(g => g.Key, g => (g.Quantity, g.Discount));

    private async Task<Dictionary<Guid, decimal>> ReturnedQuantitiesAsync(Guid originalOrderId) =>
        (await ReturnedAsync(originalOrderId)).ToDictionary(r => r.Key, r => r.Value.Quantity);

    private List<PosPayment> BuildPayments(PosOrderRequest request, Dictionary<Guid, PaymentMethod> methods, decimal total, Partner? customer,
        bool allowNoPayments = false, IReadOnlyDictionary<Guid, decimal?>? partnerLimits = null)
    {
        var payments = new List<PosPayment>();
        var charged = new Dictionary<Guid, decimal>();
        foreach (var p in request.Payments)
        {
            if (!methods.TryGetValue(p.PaymentMethodId, out var method)) throw Fail("PosTenderNotFound");
            if (p.Amount <= 0) throw Fail("PosAmountInvalid");
            // P7: an on-account tender may charge the prescription's payer, the fleet card's company
            // or the courier, up to what each may take.
            if (p.PartnerId is { } partnerId)
            {
                if (method.Kind != PaymentMethodKind.OnAccount || partnerLimits is null || !partnerLimits.TryGetValue(partnerId, out var limit))
                {
                    throw Fail("PosTenderPartnerInvalid");
                }
                charged[partnerId] = charged.GetValueOrDefault(partnerId) + PosPricing.Money(p.Amount);
                if (limit is { } max && charged[partnerId] > max) throw Fail("PosTenderPartnerLimit", max);
            }
            else if (method.Kind == PaymentMethodKind.OnAccount && customer is null) throw Fail("PosOnAccountNeedsCustomer");
            var amount = PosPricing.Money(p.Amount);
            var tip = PosPricing.Money(p.Tip);
            if (tip < 0 || (tip > 0 && request.Kind != PosOrderKind.Sale)) throw Fail("PosAmountInvalid");
            if (p.Tendered is { } tendered && (method.Kind != PaymentMethodKind.Cash || tendered < amount + tip)) throw Fail("PosAmountInvalid");
            payments.Add(new PosPayment
            {
                Id = Guid.NewGuid(), PaymentMethodId = method.Id, Amount = amount, Tip = tip,
                Tendered = p.Tendered is { } t ? PosPricing.Money(t) : null, Reference = p.Reference?.Trim(), PartnerId = p.PartnerId,
            });
        }
        if (payments.Count == 0 && total != 0 && !allowNoPayments) throw Fail("PosOrderNoPayments");
        if (payments.Sum(p => p.Amount) != total) throw Fail("PosPaymentsDontMatch", payments.Sum(p => p.Amount), total);

        // Cash above €2,000 from an individual is not allowed (whole deal, not per tender).
        var cash = payments.Where(p => methods[p.PaymentMethodId].Kind == PaymentMethodKind.Cash).Sum(p => p.Amount);
        var individual = customer is null || (string.IsNullOrWhiteSpace(customer.TaxNumber) && !customer.IsVatRegistered);
        if (request.Kind == PosOrderKind.Sale && individual && cash > CashLimitB2C) throw Fail("PosCashLimit", CashLimitB2C);
        return payments;
    }

    // ---- P7: pharmacy, fuel, fleet cards, online orders ----

    // Prescription-only medicines are sold against a line of the prescription (no more than is left
    // on it); a fuel line names a nozzle of this store drawing that grade; a fleet card that pays for
    // fuel only takes only fuel.
    private async Task CheckSpecialistLinesAsync(Company company, Store store, PosOrderRequest request, List<PosOrderLine> lines, PosOrder? original,
        Prescription? prescription, FleetCard? fleetCard)
    {
        if (original is not null) return;
        var itemIds = lines.Where(l => l.ItemId != null).Select(l => l.ItemId!.Value).Distinct().ToList();
        var rxOnly = await _db.Items.AsNoTracking().Where(i => itemIds.Contains(i.Id) && i.IsPrescriptionOnly).Select(i => i.Id).ToListAsync();
        var dispensing = new Dictionary<Guid, decimal>();
        foreach (var line in lines)
        {
            if (line.PrescriptionLineId is { } rxLineId)
            {
                var rxLine = prescription?.Lines.FirstOrDefault(x => x.Id == rxLineId);
                if (rxLine is null || rxLine.ItemId != line.ItemId) throw Fail("PosPrescriptionLineInvalid", line.Description);
                dispensing[rxLineId] = dispensing.GetValueOrDefault(rxLineId) + line.Quantity * line.UnitFactor;
                if (dispensing[rxLineId] > rxLine.Quantity - rxLine.Dispensed) throw Fail("PosPrescriptionExceeded", line.Description, rxLine.Quantity - rxLine.Dispensed);
            }
            else if (line.ItemId is { } id && rxOnly.Contains(id))
            {
                throw Fail("PosPrescriptionRequired", line.Description);
            }
        }

        var nozzleIds = lines.Where(l => l.NozzleId != null).Select(l => l.NozzleId!.Value).Distinct().ToList();
        var tanks = await _db.PosFuelTanks.AsNoTracking().Where(t => t.StoreId == store.Id && t.CompanyId == company.Id).ToListAsync();
        if (nozzleIds.Count > 0)
        {
            var nozzles = await _db.PosFuelNozzles.AsNoTracking().Where(n => nozzleIds.Contains(n.Id) && n.StoreId == store.Id && n.IsActive)
                .ToDictionaryAsync(n => n.Id, n => n.TankId);
            foreach (var line in lines.Where(l => l.NozzleId != null))
            {
                if (!nozzles.TryGetValue(line.NozzleId!.Value, out var tankId) || tanks.FirstOrDefault(t => t.Id == tankId)?.ItemId != line.ItemId)
                {
                    throw Fail("PosNozzleInvalid", line.Description);
                }
            }
        }
        if (fleetCard is { FuelOnly: true })
        {
            var grades = tanks.Select(t => t.ItemId).ToHashSet();
            if (lines.Any(l => l.ItemId is not { } id || !grades.Contains(id))) throw Fail("PosFleetCardFuelOnly");
        }
    }

    // Who an on-account tender may charge besides the customer, and up to how much: the payer its
    // share of the prescription lines, the fleet card's company its limit per fill, the courier the
    // cash it collects. A return refunds whoever the sale charged, up to what it charged them.
    private async Task<Dictionary<Guid, decimal?>> TenderPartnersAsync(List<PosOrderLine> lines, PosOrder? original, Prescription? prescription,
        FleetCard? fleetCard, ChannelOrder? channelOrder, decimal total)
    {
        var result = new Dictionary<Guid, decimal?>();
        if (original is not null)
        {
            foreach (var g in original.Payments.Where(p => p.PartnerId != null).GroupBy(p => p.PartnerId!.Value)) result[g.Key] = g.Sum(p => p.Amount);
            return result;
        }
        if (prescription?.PayerId is { } payerId)
        {
            var payer = await _db.PosPayers.AsNoTracking().FirstAsync(p => p.Id == payerId);
            var covered = lines.Where(l => l.PrescriptionLineId != null).Sum(l => l.Gross);
            result[payer.PartnerId] = PosPricing.Money(covered * prescription.CoveragePercent / 100m);
        }
        if (fleetCard is not null) result[fleetCard.PartnerId] = fleetCard.LimitPerFill is { } limit ? Math.Min(limit, total) : total;
        if (channelOrder is { Payment: ChannelPayment.CashOnDelivery, CourierPartnerId: { } courier }) result[courier] = total;
        return result;
    }

    // What the order dispensed (or a return gave back) is counted on the prescription lines.
    private static void ApplyPrescription(Prescription prescription, PosOrder order)
    {
        var sign = order.Kind == PosOrderKind.Sale ? 1m : -1m;
        foreach (var line in order.Lines.Where(l => l.PrescriptionLineId != null))
        {
            var rxLine = prescription.Lines.FirstOrDefault(x => x.Id == line.PrescriptionLineId);
            if (rxLine is not null) rxLine.Dispensed = Math.Max(0m, rxLine.Dispensed + sign * line.Quantity * line.UnitFactor);
        }
        prescription.State = prescription.State == PrescriptionState.Cancelled ? PrescriptionState.Cancelled
            : prescription.Lines.All(l => l.Dispensed >= l.Quantity) ? PrescriptionState.Dispensed
            : prescription.Lines.Any(l => l.Dispensed > 0) ? PrescriptionState.PartlyDispensed
            : PrescriptionState.Open;
    }

    // ---- Fiscal ----

    // ATK CouponId must be unique across the business without the tills talking to each other:
    // branch (3 digits) · POS (3 digits) · the till's own running number (10 digits).
    public static long CouponIdFor(int branch, int pos, long sequence) => (long)branch * 10_000_000_000_000L + (long)pos * 10_000_000_000L + sequence;

    // The next number in this branch·POS range, whoever used it before (a register renumbered, or
    // replaced): counting the register's own coupons could hand out an id already taken.
    private async Task<long> NextCouponIdAsync(Guid companyId, int branch, int pos)
    {
        var first = CouponIdFor(branch, pos, 1);
        var last = CouponIdFor(branch, pos, 9_999_999_999L);
        var max = await _db.FiscalDocuments.Where(d => d.CompanyId == companyId && d.CouponId >= first && d.CouponId <= last)
            .MaxAsync(d => (long?)d.CouponId);
        return (max ?? first - 1) + 1;
    }

    private async Task<FiscalDocument> FiscalizeAsync(Company company, PosRegister register, Store store, PosOrder order, PosOrder? original,
        PosFiscalRequest? fiscal, Dictionary<Guid, PaymentMethod> methods)
    {
        var originalDoc = original is null ? null : await _db.FiscalDocuments.AsNoTracking().FirstOrDefaultAsync(d => d.OrderId == original.Id);
        var type = order.Kind switch
        {
            PosOrderKind.Cancel => FiscalCouponType.Cancel,
            PosOrderKind.Return => FiscalCouponType.Return,
            _ => FiscalCouponType.Sale,
        };
        var businessId = BusinessIdOf(company);

        if (register.FiscalMode == FiscalMode.Training)
        {
            // Training (D4): built and signed like a real coupon so the till and the printout behave
            // the same, but with a throw-away key and never sent to ATK.
            var couponId = await NextCouponIdAsync(company.Id, store.FiscalBranchNumber, register.FiscalPosNumber);
            var request = CouponRequest(order, register, store, businessId, (ulong)couponId, RandomVerificationNo(), order.OrderedAt,
                originalDoc?.CouponId, type, methods);
            var built = CouponBuilder.Build(request);
            using var key = FiscalPki.GenerateKey();
            using var signer = new CouponSigner(key);
            var signed = signer.SignPosCoupon(built.Pos);
            return new FiscalDocument
            {
                Id = Guid.NewGuid(), CompanyId = company.Id, RegisterId = register.Id, OrderId = order.Id, Type = FiscalDocumentType.Training,
                CouponId = couponId, DailyNumber = await DailyNumberAsync(register.Id, order.OrderedAt), ReferenceCouponId = originalDoc?.CouponId,
                VerificationNo = request.VerificationNo, IssuedAt = order.OrderedAt, PosCouponDetails = signed.Details, Signature = signed.Signature,
                QrCode = signer.QrCode(built.Citizen), AtkStatus = AtkStatus.NotSent,
            };
        }

        if (register.FiscalMode != FiscalMode.Sef) throw Fail("PosFiscalModeUnsupported");
        if (fiscal is null) throw Fail("PosFiscalRequired");
        if (register.CertificatePem is null) throw Fail("PosRegisterNotOnboarded");
        if (original is not null && originalDoc is null) throw Fail("PosOriginalOrderNotFound");

        // The till signed the coupon; check the signature with the certificate ATK issued for it, and
        // that the coupon says exactly what the server computes for this order.
        var issuedAt = DateTime.SpecifyKind(fiscal.IssuedAt, DateTimeKind.Utc);
        var (publicKey, notBefore, notAfter, _) = FiscalPki.ReadCertificate(register.CertificatePem);
        using (publicKey)
        {
            if (issuedAt < notBefore || issuedAt > notAfter) throw Fail("PosCertificateExpired");
            try
            {
                if (!CouponVerifier.Verify(publicKey, fiscal.Details, fiscal.Signature)) throw Fail("PosFiscalSignatureInvalid");
                if (CouponVerifier.ReadQrCode(publicKey, fiscal.QrCode) is not { } citizen) throw Fail("PosFiscalSignatureInvalid");
                var sent = PosCoupon.Parser.ParseFrom(Convert.FromBase64String(fiscal.Details));
                var expected = CouponBuilder.Build(CouponRequest(order, register, store, businessId, (ulong)fiscal.CouponId, fiscal.VerificationNo,
                    issuedAt, originalDoc?.CouponId, type, methods, sent.OperatorId, sent.ApplicationId));
                // The signed coupon is the legal record of this order: every field must be what the
                // server computes (items, payments, time, discount), except what only ATK assigns.
                var pos = expected.Pos.Clone();
                pos.TransactionNo = sent.TransactionNo;
                if (!sent.Equals(pos) || !citizen.Equals(expected.Citizen)) throw Fail("PosFiscalMismatch");
            }
            catch (Exception ex) when (ex is FormatException or Google.Protobuf.InvalidProtocolBufferException or CryptographicException)
            {
                throw Fail("PosFiscalSignatureInvalid");
            }
        }

        var accepted = fiscal.SentToAtk && fiscal.AtkTransactionNo is > 0;
        return new FiscalDocument
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, RegisterId = register.Id, OrderId = order.Id, Type = (FiscalDocumentType)type,
            CouponId = fiscal.CouponId, DailyNumber = fiscal.DailyNumber, ReferenceCouponId = originalDoc?.CouponId,
            VerificationNo = fiscal.VerificationNo, IssuedAt = issuedAt,
            PosCouponDetails = fiscal.Details, Signature = fiscal.Signature, QrCode = fiscal.QrCode,
            // Sent only counts with ATK's transaction number to show for it.
            AtkStatus = accepted ? AtkStatus.Accepted : AtkStatus.Pending, AtkTransactionNo = fiscal.AtkTransactionNo,
            SentAt = accepted ? DateTime.UtcNow : null,
            SendBy = accepted ? null : issuedAt + OfflineDeadline,
        };
    }

    public static ulong BusinessIdOf(Company company)
    {
        var nui = new string((company.FiscalNumber ?? company.BusinessNumber ?? "").Where(char.IsDigit).ToArray());
        return ulong.TryParse(nui, out var id) ? id : 0;
    }

    private static FiscalCouponRequest CouponRequest(PosOrder order, PosRegister register, Store store, ulong businessId, ulong couponId,
        string verificationNo, DateTime issuedAt, long? reference, FiscalCouponType type, Dictionary<Guid, PaymentMethod> methods,
        string? operatorId = null, ulong applicationId = 0) =>
        new(new FiscalIssuer(businessId == 0 ? 1 : businessId, (ulong)store.FiscalBranchNumber, (ulong)register.FiscalPosNumber, applicationId, store.Location),
            couponId, type, new DateTimeOffset(issuedAt, TimeSpan.Zero), operatorId ?? order.OperatorName, verificationNo,
            order.Lines.OrderBy(l => l.LineNo).Select(l => new FiscalCouponLine(l.Description, l.Unit, l.Quantity, l.UnitPrice, l.Gross, l.TaxLetter)).ToList(),
            order.Payments.Select(p => new FiscalCouponPayment(AtkPaymentType(methods[p.PaymentMethodId].Kind), p.Amount)).ToList(),
            (ulong)(reference ?? 0), order.TotalDiscount);

    private static FiscalPaymentType AtkPaymentType(PaymentMethodKind kind) => kind switch
    {
        PaymentMethodKind.Cash => FiscalPaymentType.Cash,
        PaymentMethodKind.Card => FiscalPaymentType.CreditCard,
        PaymentMethodKind.Voucher or PaymentMethodKind.GiftCard => FiscalPaymentType.Voucher,
        _ => FiscalPaymentType.Other,
    };

    private static string RandomVerificationNo() => Convert.ToHexString(RandomNumberGenerator.GetBytes(8));

    private async Task<int> DailyNumberAsync(Guid registerId, DateTime at)
    {
        // Kosovo's calendar day, expressed back in UTC for the query.
        var local = LocalTime(at).Date;
        var day = TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(local, DateTimeKind.Unspecified), Kosovo);
        var next = TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(local.AddDays(1), DateTimeKind.Unspecified), Kosovo);
        return await _db.FiscalDocuments.CountAsync(d => d.RegisterId == registerId && d.IssuedAt >= day && d.IssuedAt < next) + 1;
    }

    // ---- Stock ----

    // D6/D7: each order moves its stock as it happens; sales leave the store's warehouse, returns and
    // cancellations come back at the cost the sale took them out at.
    private async Task MoveStockAsync(Company company, Store store, PosOrder order, PosOrder? original)
    {
        // P3: what each line takes from stock — the item itself, or for a dish its recipe's
        // ingredients (expanded, with waste) and its modifiers' changes.
        var itemIds = order.Lines.Where(l => l.ItemId != null).Select(l => l.ItemId!.Value).Distinct().ToList();
        var recipes = await RecipesAsync(itemIds);
        var modifierIds = order.Lines.Where(l => l.ModifierIds != null)
            .SelectMany(l => l.ModifierIds!.Split(',', StringSplitOptions.RemoveEmptyEntries)).Select(Guid.Parse).Distinct().ToList();
        var modifiers = modifierIds.Count == 0 ? new Dictionary<Guid, Modifier>()
            : await _db.PosModifiers.AsNoTracking().Where(m => modifierIds.Contains(m.Id) && m.IngredientItemId != null).ToDictionaryAsync(m => m.Id);

        var needs = new List<(PosOrderLine Line, Guid ItemId, decimal Quantity)>();
        foreach (var line in order.Lines.Where(l => l.ItemId != null))
        {
            var quantity = line.Quantity * line.UnitFactor;
            if (!recipes.ContainsKey(line.ItemId!.Value))
            {
                needs.Add((line, line.ItemId.Value, quantity));
                continue;
            }
            // A dish that comes back was still made: its ingredients don't return to stock.
            if (order.Kind != PosOrderKind.Sale) continue;
            var parts = new Dictionary<Guid, decimal>();
            Expand(recipes, line.ItemId.Value, quantity, parts, 0);
            foreach (var id in (line.ModifierIds ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries).Select(Guid.Parse))
            {
                if (modifiers.TryGetValue(id, out var m)) parts[m.IngredientItemId!.Value] = parts.GetValueOrDefault(m.IngredientItemId!.Value) + m.IngredientQuantity!.Value * quantity;
            }
            needs.AddRange(parts.Where(p => p.Value > 0).Select(p => (line, p.Key, p.Value)));
        }

        var tracked = await _stock.TrackedItemsAsync(company.Id, needs.Select(n => (Guid?)n.ItemId));
        needs = needs.Where(n => tracked.ContainsKey(n.ItemId)).ToList();
        if (needs.Count == 0) return;
        var location = await _stock.DocumentLocationAsync(company.Id, store.WarehouseId);
        var customer = await _stock.VirtualLocationAsync(company.Id, LocationUsage.Customer);
        var originalCost = new Dictionary<Guid, decimal>();
        if (original is not null)
        {
            originalCost = (await _db.StockMoves.AsNoTracking()
                    .Where(m => m.SourceType == StockMoveSource.Pos && m.SourceId == original.Id && m.Kind == StockMoveKind.Issue && m.Quantity > 0)
                    .Select(m => new { Line = m.SourceLineId!.Value, m.Value, m.Quantity, m.QtyAfter }).ToListAsync())
                // A sale that took the stock below zero was valued at the old average; its return
                // comes back at the current average instead (as invoices do).
                .Where(m => m.QtyAfter >= 0)
                .GroupBy(m => m.Line).ToDictionary(g => g.Key, g => g.Sum(m => m.Value) / g.Sum(m => m.Quantity));
        }

        var requests = needs.Select(n => order.Kind == PosOrderKind.Sale
                ? new StockService.MoveRequest(n.ItemId, StockMoveKind.Issue, location.Id, customer.Id, n.Quantity, SourceLineId: n.Line.Id,
                    LotNumber: n.ItemId == n.Line.ItemId ? n.Line.LotNumber : null)
                : new StockService.MoveRequest(n.ItemId, StockMoveKind.Receipt, customer.Id, location.Id, n.Quantity,
                    n.Line.OriginalLineId is { } sold && originalCost.TryGetValue(sold, out var unit) ? AverageCost.Money(unit * n.Quantity) : null,
                    n.Line.Id, n.Line.LotNumber))
            .ToList();
        var posting = await _stock.ApplyAsync(company.Id, DateOnly.FromDateTime(LocalTime(order.OrderedAt)), StockMoveSource.Pos, order.Id, order.Number, requests);
        // The session posts these snapshots, never the moves' later (replayed) values.
        var lines = order.Lines.ToDictionary(l => l.Id);
        foreach (var outcome in posting.Moves)
        {
            var line = lines[outcome.Request.SourceLineId!.Value];
            line.CostValue += outcome.Move.Value;
            line.CostCorrection += outcome.Correction;
        }
        foreach (var (itemId, delta) in posting.ReplayCogsDelta)
        {
            lines[needs.First(n => n.ItemId == itemId).Line.Id].CostReplay += delta;
        }
    }

    // Recipes of these items and of their ingredients, as far as they go.
    private async Task<Dictionary<Guid, List<RecipeLine>>> RecipesAsync(IReadOnlyCollection<Guid> itemIds)
    {
        var all = new Dictionary<Guid, List<RecipeLine>>();
        var next = itemIds.ToList();
        for (var depth = 0; depth < RecipeDepth && next.Count > 0; depth++)
        {
            var found = await _db.RecipeLines.AsNoTracking().Where(r => next.Contains(r.ItemId)).ToListAsync();
            foreach (var g in found.GroupBy(r => r.ItemId)) all[g.Key] = g.OrderBy(r => r.SortOrder).ToList();
            next = found.Select(r => r.IngredientItemId).Distinct().Where(id => !all.ContainsKey(id)).ToList();
        }
        return all;
    }

    public const int RecipeDepth = 5;

    private static void Expand(Dictionary<Guid, List<RecipeLine>> recipes, Guid itemId, decimal quantity, Dictionary<Guid, decimal> into, int depth)
    {
        foreach (var r in recipes[itemId])
        {
            var needed = quantity * r.Quantity * (1 + r.WastePercent / 100m);
            if (depth + 1 < RecipeDepth && recipes.ContainsKey(r.IngredientItemId)) Expand(recipes, r.IngredientItemId, needed, into, depth + 1);
            else into[r.IngredientItemId] = into.GetValueOrDefault(r.IngredientItemId) + needed;
        }
    }

    // ---- Posting (D6) ----

    public async Task PostSessionAsync(Company company, PosSession session, PosRegister register, Guid userId)
    {
        var orderIds = await _db.PosOrders.Where(o => o.SessionId == session.Id).Select(o => o.Id).ToListAsync();
        var entry = await BuildEntryAsync(company, session, register, orderIds, includeSessionCash: true, label: $"POS {register.Code} #{session.Number}");
        if (entry is not null)
        {
            var effective = await AccountLockService.GetEffectiveCompanyAsync(_db, company, userId);
            entry.Post(effective);
            entry.PostedByUserId = userId;
            entry.SourceDocumentId = session.Id;
            _db.JournalEntries.Add(entry);
            session.JournalEntryId = entry.Id;
        }
        session.State = PosSessionState.Posted;
    }

    private async Task PostOrdersAsync(Company company, PosSession session, PosRegister register, IReadOnlyList<Guid> orderIds, Guid userId, bool adjustment)
    {
        var entry = await BuildEntryAsync(company, session, register, orderIds, includeSessionCash: false,
            label: $"POS {register.Code} #{session.Number} {(adjustment ? _localizer["PosLateOrder"].Value : "")}".Trim());
        if (entry is null) return;
        var effective = await AccountLockService.GetEffectiveCompanyAsync(_db, company, userId);
        entry.Post(effective);
        entry.PostedByUserId = userId;
        entry.SourceDocumentId = session.Id;
        _db.JournalEntries.Add(entry);
    }

    // One entry: revenue per account × VAT code and VAT per code (tax-coded, so the VAT return reads
    // them like invoices), money per tender, cost of goods sold from the stock moves, cash movements
    // and the counted differences (over/short). Returns and cancellations reverse their sides.
    private async Task<JournalEntry?> BuildEntryAsync(Company company, PosSession session, PosRegister register, IReadOnlyList<Guid> orderIds,
        bool includeSessionCash, string label)
    {
        var orders = await _db.PosOrders.AsNoTracking().Include(o => o.Lines).Include(o => o.Payments)
            .Where(o => orderIds.Contains(o.Id)).ToListAsync();
        var journal = await JournalResolver.GetAsync(_db, company.Id, JournalType.Sale) ?? await JournalResolver.GetAsync(_db, company.Id, JournalType.General)
            ?? throw Fail("NoJournalToPost");
        var entry = new JournalEntry
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, JournalId = journal.Id,
            Date = includeSessionCash ? session.BusinessDate : orders.Select(o => DateOnly.FromDateTime(o.OrderedAt)).DefaultIfEmpty(session.BusinessDate).Max(),
            Reference = label, Remarks = label,
        };
        var taxIds = orders.SelectMany(o => o.Lines).Where(l => l.TaxDefinitionId != null).Select(l => l.TaxDefinitionId!.Value).Distinct().ToList();
        var taxes = await _db.TaxDefinitions.AsNoTracking().Include(t => t.RepartitionLines).Where(t => taxIds.Contains(t.Id)).ToDictionaryAsync(t => t.Id);
        var methods = await _db.PaymentMethods.AsNoTracking().Where(m => m.CompanyId == company.Id).ToDictionaryAsync(m => m.Id);

        void Add(Guid account, decimal signedDebit, Guid? taxId = null, Guid? partnerId = null, string? description = null, Guid? employeeId = null)
        {
            signedDebit = PosPricing.Money(signedDebit);
            if (signedDebit == 0) return;
            entry.Lines.Add(new JournalEntryLine
            {
                Id = Guid.NewGuid(), AccountId = account, Debit = signedDebit > 0 ? signedDebit : 0, Credit = signedDebit < 0 ? -signedDebit : 0,
                TaxId = taxId, PartnerId = partnerId, Description = description ?? label, EmployeeId = employeeId,
            });
        }

        static decimal Sign(PosOrder o) => o.Kind == PosOrderKind.Sale ? 1m : -1m;

        // Revenue (credit) per revenue account and VAT code. P7: of an agency line only the commission
        // is revenue; the rest is owed to the principal.
        foreach (var g in orders.SelectMany(o => o.Lines.Select(l => (o, l))).GroupBy(x => (x.l.RevenueAccountId, x.l.TaxDefinitionId)))
        {
            Add(g.Key.RevenueAccountId, -g.Sum(x => Sign(x.o) * (x.l.AgencyPartnerId != null ? x.l.AgencyCommission : x.l.Net)), g.Key.TaxDefinitionId);
        }
        var agencyLines = orders.SelectMany(o => o.Lines.Select(l => (o, l))).Where(x => x.l.AgencyPartnerId != null).ToList();
        if (agencyLines.Count > 0)
        {
            var principalIds = agencyLines.Select(x => x.l.AgencyPartnerId!.Value).Distinct().ToList();
            var payables = await _db.Partners.AsNoTracking().Where(p => principalIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.PayableAccountId);
            var defaultPayable = await _db.CompanyAccountDefaults.AsNoTracking().Where(d => d.CompanyId == company.Id)
                .Select(d => (Guid?)d.PayableAccountId).FirstOrDefaultAsync();
            foreach (var g in agencyLines.GroupBy(x => x.l.AgencyPartnerId!.Value))
            {
                var payable = payables.GetValueOrDefault(g.Key) ?? defaultPayable ?? throw Fail("NoAccountDefaults");
                Add(payable, -g.Sum(x => Sign(x.o) * (x.l.Net - x.l.AgencyCommission)), partnerId: g.Key,
                    description: $"{label} · {_localizer["PosAgencySales"].Value}");
            }
        }
        // VAT (credit) per VAT code, on its repartition accounts.
        foreach (var g in orders.SelectMany(o => o.Lines.Select(l => (o, l))).Where(x => x.l.TaxDefinitionId != null && x.l.Tax != 0).GroupBy(x => x.l.TaxDefinitionId!.Value))
        {
            var tax = taxes[g.Key];
            var amount = g.Sum(x => Sign(x.o) * x.l.Tax);
            var repartition = tax.RepartitionLines.ToList();
            if (repartition.Count == 0) throw Fail("PosTaxNotFiscal", tax.Name);
            var allocated = 0m;
            for (var i = 0; i < repartition.Count; i++)
            {
                var share = i == repartition.Count - 1 ? amount - allocated : PosPricing.Money(amount * repartition[i].Percentage / 100m);
                allocated += share;
                Add(repartition[i].AccountId, -share, tax.Id);
            }
        }
        // Money in per tender (debit): cash to the till's drawer, on-account to the customer.
        foreach (var o in orders)
        {
            foreach (var p in o.Payments)
            {
                var method = methods[p.PaymentMethodId];
                var account = method.Kind == PaymentMethodKind.Cash ? register.CashAccountId : method.LedgerAccountId;
                Add(account, Sign(o) * (p.Amount + p.Tip), partnerId: method.Kind == PaymentMethodKind.OnAccount ? p.PartnerId ?? o.CustomerId : null);
            }
        }
        // P3: tips are owed to the staff (credit), not revenue.
        var tips = orders.SelectMany(o => o.Payments).Sum(p => p.Tip);
        if (tips != 0)
        {
            var tipsAccount = await _db.PosStores.AsNoTracking().Where(s => s.Id == register.StoreId).Select(s => s.TipsAccountId).FirstOrDefaultAsync()
                ?? await _stock.AccountIdByCodeAsync(company.Id, TipsAccountCode) ?? throw Fail("PosTipsAccountMissing");
            Add(tipsAccount, -tips, description: $"{label} · {_localizer["PosTips"].Value}");
        }

        // Cost of goods sold from the stock the orders moved, as valued when they were recorded (and
        // corrections from back-dating), on each item's own accounts.
        var costed = orders.SelectMany(o => o.Lines.Select(l => (o, l)))
            .Where(x => x.l.ItemId != null && (x.l.CostValue != 0 || x.l.CostCorrection != 0 || x.l.CostReplay != 0)).ToList();
        if (costed.Count > 0)
        {
            var itemIds = costed.Select(x => x.l.ItemId!.Value).Distinct().ToList();
            var items = await _db.Items.AsNoTracking().Where(i => itemIds.Contains(i.Id)).ToListAsync();
            var accounts = await _stock.AccountsForAsync(company.Id, items);
            foreach (var (o, l) in costed)
            {
                var a = accounts[l.ItemId!.Value];
                // A sale issues stock (Dr COGS); a return or cancellation brings it back.
                var cost = (o.Kind == PosOrderKind.Sale ? l.CostValue : -l.CostValue) + l.CostCorrection;
                StockService.AddPair(entry, a.CogsAccountId, a.InventoryAccountId, cost, label);
                if (l.CostReplay != 0) StockService.AddPair(entry, a.CogsAccountId, a.InventoryAccountId, l.CostReplay, _localizer["StockCostCorrection"].Value);
            }
        }

        if (includeSessionCash)
        {
            var movements = await _db.PosCashMovements.AsNoTracking().Where(m => m.SessionId == session.Id).ToListAsync();
            foreach (var m in movements)
            {
                var direction = CashDirection(m.Kind);
                Add(register.CashAccountId, direction * m.Amount, description: $"{label} · {m.Reason}");
                Add(m.CounterpartAccountId, -direction * m.Amount, partnerId: m.PartnerId, description: $"{label} · {m.Reason}");
            }
            // Counted vs expected: the drawer is booked at what was counted; the gap goes to over/short.
            var overShort = await _stock.AccountIdByCodeAsync(company.Id, OverShortCode);
            foreach (var t in await _db.PosSessionTenders.AsNoTracking().Where(t => t.SessionId == session.Id && t.Difference != 0).ToListAsync())
            {
                var method = methods[t.PaymentMethodId];
                var account = method.Kind == PaymentMethodKind.Cash ? register.CashAccountId : method.LedgerAccountId;
                var difference = overShort ?? throw Fail("StockAccountCodeMissing", OverShortCode);
                Add(account, t.Difference, description: $"{label} · {t.DifferenceReason}");
                Add(difference, -t.Difference, description: $"{label} · {t.DifferenceReason}");
            }
            // P3: a waiter who handed over less than their orders took owes it — moved from
            // over/short to the employee's receivable when the waiter is an employee.
            foreach (var w in await _db.PosWaiterSettlements.AsNoTracking().Where(w => w.SessionId == session.Id && w.Difference < 0).ToListAsync())
            {
                var employeeId = await _db.Employees.AsNoTracking().Where(e => e.CompanyId == company.Id && e.UserId == w.WaiterUserId)
                    .Select(e => (Guid?)e.Id).FirstOrDefaultAsync();
                if (employeeId is null) continue;
                var receivable = await _stock.AccountIdByCodeAsync(company.Id, EmployeeReceivableCode) ?? throw Fail("StockAccountCodeMissing", EmployeeReceivableCode);
                var shortage = overShort ?? throw Fail("StockAccountCodeMissing", OverShortCode);
                Add(receivable, -w.Difference, description: $"{label} · {w.WaiterName} · {w.Reason}", employeeId: employeeId);
                Add(shortage, w.Difference, description: $"{label} · {w.WaiterName} · {w.Reason}");
            }
        }

        if (entry.Lines.Count == 0) return null;
        entry.SequenceNumber = JournalSequencer.ReserveNext(journal);
        return entry;
    }

    // Cash over / short (chart of accounts v2).
    public const string OverShortCode = "100900";
    // Tips owed to staff, and what a waiter owes for a short hand-over.
    public const string TipsAccountCode = "222100";
    public const string EmployeeReceivableCode = "111100";

    // ---- Reports ----

    public async Task<SessionReportResponse> ReportAsync(PosSession session, PosRegister register)
    {
        var orders = await _db.PosOrders.AsNoTracking().Include(o => o.Lines).Include(o => o.Payments)
            .Where(o => o.SessionId == session.Id).ToListAsync();
        var methods = await _db.PaymentMethods.AsNoTracking().Where(m => m.CompanyId == session.CompanyId).ToDictionaryAsync(m => m.Id);
        var cashMethod = methods.Values.FirstOrDefault(m => m.Kind == PaymentMethodKind.Cash);
        var expected = await ExpectedAsync(session, cashMethod?.Id);
        var counted = await _db.PosSessionTenders.AsNoTracking().Where(t => t.SessionId == session.Id).ToDictionaryAsync(t => t.PaymentMethodId);
        var docs = await _db.FiscalDocuments.AsNoTracking().Where(d => orders.Select(o => o.Id).Contains(d.OrderId)).ToListAsync();
        var movements = await _db.PosCashMovements.AsNoTracking().Where(m => m.SessionId == session.Id).OrderBy(m => m.CreatedAt).ToListAsync();

        static decimal Sign(PosOrder o) => o.Kind == PosOrderKind.Sale ? 1m : -1m;
        var taxes = orders.SelectMany(o => o.Lines.Select(l => (o, l))).GroupBy(x => (x.l.TaxLetter, x.l.TaxRate)).OrderBy(g => g.Key.TaxLetter)
            .Select(g => new ReportTaxRow(g.Key.TaxLetter, g.Key.TaxRate, g.Sum(x => Sign(x.o) * x.l.Gross), g.Sum(x => Sign(x.o) * x.l.Net), g.Sum(x => Sign(x.o) * x.l.Tax)))
            .ToList();
        var tenders = expected.Keys.Union(counted.Keys).Select(id => new ReportTenderRow(id, methods.GetValueOrDefault(id)?.Name ?? "?",
                PosPricing.Money(expected.GetValueOrDefault(id)), counted.TryGetValue(id, out var c) ? c.Counted : null, c?.Difference))
            .OrderBy(t => t.Name).ToList();
        var sales = orders.Where(o => o.Kind == PosOrderKind.Sale).ToList();
        var refunds = orders.Where(o => o.Kind != PosOrderKind.Sale).Sum(o => o.Total);
        return new SessionReportResponse(session.Id, register.Code, session.Number, session.State, session.BusinessDate, session.OpenedAt, session.ClosedAt,
            session.OpeningFloat, sales.Count, orders.Count(o => o.Kind == PosOrderKind.Return), orders.Count(o => o.Kind == PosOrderKind.Cancel),
            sales.Sum(o => o.Total), refunds, sales.Sum(o => o.Total) - refunds, taxes, tenders,
            movements.Select(m => new CashMovementResponse(m.Id, m.Kind, m.Amount, m.Reason, m.CounterpartAccountId, m.CreatedAt)).ToList(),
            cashMethod is null ? 0m : PosPricing.Money(expected.GetValueOrDefault(cashMethod.Id)),
            docs.Count(d => d.AtkStatus == AtkStatus.Pending), docs.Count == 0 ? null : docs.Min(d => d.CouponId), docs.Count == 0 ? null : docs.Max(d => d.CouponId),
            session.JournalEntryId);
    }

    // ---- Waiters (P3) ----

    public async Task<List<WaiterSummaryResponse>> WaitersAsync(PosSession session)
    {
        var orders = await _db.PosOrders.AsNoTracking().Include(o => o.Payments).Where(o => o.SessionId == session.Id).ToListAsync();
        var methods = await _db.PaymentMethods.AsNoTracking().Where(m => m.CompanyId == session.CompanyId).ToDictionaryAsync(m => m.Id, m => m.Kind);
        var settlements = await _db.PosWaiterSettlements.AsNoTracking().Where(w => w.SessionId == session.Id).ToDictionaryAsync(w => w.WaiterUserId);
        return orders.GroupBy(o => o.OperatorUserId).Select(g =>
        {
            static decimal Sign(PosOrder o) => o.Kind == PosOrderKind.Sale ? 1m : -1m;
            var payments = g.SelectMany(o => o.Payments.Select(p => (o, p))).ToList();
            var cash = payments.Where(x => methods.GetValueOrDefault(x.p.PaymentMethodId) == PaymentMethodKind.Cash).Sum(x => Sign(x.o) * x.p.Amount);
            var cashTips = payments.Where(x => methods.GetValueOrDefault(x.p.PaymentMethodId) == PaymentMethodKind.Cash).Sum(x => x.p.Tip);
            var other = payments.Where(x => methods.GetValueOrDefault(x.p.PaymentMethodId) != PaymentMethodKind.Cash).Sum(x => Sign(x.o) * x.p.Amount);
            var settled = settlements.GetValueOrDefault(g.Key);
            return new WaiterSummaryResponse(g.Key, g.OrderByDescending(o => o.OrderedAt).First().OperatorName, g.Count(o => o.Kind == PosOrderKind.Sale),
                g.Sum(o => Sign(o) * o.Total), cash, other, payments.Sum(x => x.p.Tip), cash + cashTips,
                settled is null ? null : new WaiterSettlementResponse(settled.Id, settled.Expected, settled.Handed, settled.Difference, settled.Reason, settled.CreatedAt));
        }).OrderBy(w => w.WaiterName).ToList();
    }

    // A waiter hands over their cash: what their orders took against what they hand; a difference
    // needs a reason. Done once per waiter and session, while the session is open.
    public async Task<WaiterSettlement> SettleWaiterAsync(PosSession session, SettleWaiterRequest request, Guid userId)
    {
        if (session.State != PosSessionState.Open) throw Fail("PosSessionNotOpen");
        if (request.Handed < 0) throw Fail("PosAmountInvalid");
        var summary = (await WaitersAsync(session)).FirstOrDefault(w => w.WaiterUserId == request.WaiterUserId) ?? throw Fail("PosWaiterNotFound");
        if (summary.Settlement is not null) throw Fail("PosWaiterSettled");
        var handed = PosPricing.Money(request.Handed);
        var difference = handed - summary.CashExpected;
        if (difference != 0 && string.IsNullOrWhiteSpace(request.Reason)) throw Fail("PosDifferenceReasonRequired", summary.WaiterName);
        var settlement = new WaiterSettlement
        {
            Id = Guid.NewGuid(), SessionId = session.Id, WaiterUserId = request.WaiterUserId, WaiterName = summary.WaiterName, Expected = summary.CashExpected,
            Handed = handed, Difference = difference, Reason = string.IsNullOrWhiteSpace(request.Reason) ? null : request.Reason.Trim(), CreatedByUserId = userId,
        };
        _db.PosWaiterSettlements.Add(settlement);
        return settlement;
    }

    public async Task<PosOrderResponse> ToResponseAsync(PosOrder order, FiscalDocument? fiscal)
    {
        var methods = await _db.PaymentMethods.AsNoTracking().Where(m => m.CompanyId == order.CompanyId).ToDictionaryAsync(m => m.Id, m => m.Name);
        var returned = order.Kind == PosOrderKind.Sale ? await ReturnedQuantitiesAsync(order.Id) : new Dictionary<Guid, decimal>();
        var programIds = order.Lines.Where(l => l.ProgramId != null).Select(l => l.ProgramId!.Value).Distinct().ToList();
        var programNames = programIds.Count == 0 ? new Dictionary<Guid, string>()
            : await _db.PosPrograms.AsNoTracking().Where(p => programIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.Name);
        var cards = await (from m in _db.GiftCardMovements.AsNoTracking()
                           join c in _db.GiftCards.AsNoTracking() on m.GiftCardId equals c.Id
                           where m.OrderId == order.Id
                           select new PosCardResponse(c.Number, c.Kind, m.Amount, c.Balance)).ToListAsync();
        var points = order.LoyaltyCardId is { } cardId
            ? await _db.LoyaltyCards.AsNoTracking().Where(c => c.Id == cardId).Select(c => (decimal?)c.Points).FirstOrDefaultAsync()
            : null;
        return new PosOrderResponse(order.Id, order.ClientUuid, order.Number, order.Kind, order.State, order.OrderedAt, order.OperatorName, order.CustomerId,
            order.OriginalOrderId, order.Total, order.TotalTax, order.TotalDiscount,
            order.Lines.OrderBy(l => l.LineNo).Select(l => new PosOrderLineResponse(l.Id, l.LineNo, l.ItemId, l.Description, l.Unit, l.Quantity, l.UnitPrice,
                l.DiscountAmount, l.TaxLetter, l.Gross, l.Net, l.Tax,
                order.Kind == PosOrderKind.Sale && order.State == PosOrderState.Paid && l.GiftCardNumber == null ? l.Quantity - returned.GetValueOrDefault(l.Id) : null,
                l.ProgramId is { } pid ? programNames.GetValueOrDefault(pid) : null, l.SerialNumber, l.PackageNumber, l.MembershipNumber)).ToList(),
            order.Payments.Select(p => new PosPaymentResponse(p.PaymentMethodId, methods.GetValueOrDefault(p.PaymentMethodId) ?? "?", p.Amount, p.Tendered, p.Tip)).ToList(),
            fiscal is null ? null : new FiscalDocumentResponse(fiscal.Type, fiscal.CouponId, fiscal.DailyNumber, fiscal.ReferenceCouponId, fiscal.VerificationNo,
                fiscal.IssuedAt, fiscal.QrCode, fiscal.AtkStatus, fiscal.AtkTransactionNo, fiscal.AtkError, fiscal.SendBy),
            order.Payments.Where(p => p.Tendered != null).Sum(p => p.Tendered!.Value - p.Amount - p.Tip),
            order.Lines.GroupBy(l => (l.TaxLetter, l.TaxRate)).OrderBy(g => g.Key.TaxLetter)
                .Select(g => new ReportTaxRow(g.Key.TaxLetter, g.Key.TaxRate, g.Sum(l => l.Gross), g.Sum(l => l.Net), g.Sum(l => l.Tax))).ToList(),
            order.RegisterId, cards, order.PointsEarned, order.PointsRedeemed, points,
            await (from t in _db.PosTickets.AsNoTracking()
                   join e in _db.PosTicketedEvents.AsNoTracking() on t.EventId equals e.Id
                   join i in _db.Items.AsNoTracking() on t.ItemId equals i.Id
                   where t.OrderId == order.Id
                   orderby t.CreatedAt
                   select new TicketResponse(t.Code, e.Name, e.StartsAt, i.Name, t.State)).ToListAsync());
    }
}

public class PosException(string message) : Exception(message);
