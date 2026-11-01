using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Contracts;
using Pako.Domain.Companies;
using Pako.Domain.Pos;
using Pako.Infrastructure;

namespace Pako.Api.Services;

// docs/POS_PLAN.md P3: tabs (open tickets) — what a table orders, sends to the kitchen and finally
// pays. Every amount is computed here with PosPricing; paying goes through PosService like any sale.
public class TabService
{
    private readonly PakoDbContext _db;
    private readonly PriceListService _prices;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public TabService(PakoDbContext db, PriceListService prices, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _prices = prices;
        _localizer = localizer;
    }

    private PosException Fail(string key, params object[] args) =>
        new(args.Length == 0 ? _localizer[key].Value : string.Format(_localizer[key].Value, args));

    public static bool IsOpen(Tab tab) => tab.State is TabState.Open or TabState.PreBilled;

    // ---- Opening ----

    public async Task<Tab> OpenAsync(Guid companyId, Store store, OpenTabRequest request, Guid userId, string waiterName)
    {
        if (request.TableId is { } tableId
            && !await _db.PosTables.AnyAsync(t => t.Id == tableId && t.IsActive && _db.PosFloors.Any(f => f.Id == t.FloorId && f.StoreId == store.Id)))
        {
            throw Fail("PosTableNotFound");
        }
        if (request.Covers is < 0 or > 500) throw Fail("PosAmountInvalid");
        var count = await _db.PosTabs.CountAsync(t => t.CompanyId == companyId);
        var tab = new Tab
        {
            Id = Guid.NewGuid(), CompanyId = companyId, StoreId = store.Id, TableId = request.TableId, Number = $"T{count + 1:D5}",
            Name = Blank(request.Name), Kind = request.Kind, State = TabState.Open, Covers = request.Covers, WaiterUserId = userId, WaiterName = waiterName,
            DeliveryAddress = Blank(request.DeliveryAddress), DeliveryPhone = Blank(request.DeliveryPhone),
        };
        _db.PosTabs.Add(tab);
        return tab;
    }

    // ---- Lines ----

    public async Task AddLinesAsync(Guid companyId, Tab tab, Store store, IReadOnlyList<AddTabLineRequest> requests, TabLineState state = TabLineState.Pending)
    {
        if (!IsOpen(tab)) throw Fail("PosTabClosed");
        if (requests.Count == 0) throw Fail("PosOrderNoLines");
        var itemIds = requests.Select(r => r.ItemId)
            .Concat(requests.SelectMany(r => r.ComboChoices ?? new()).Select(c => c.ItemId)).Distinct().ToList();
        var items = await _db.Items.AsNoTracking().Where(i => i.CompanyId == companyId && itemIds.Contains(i.Id) && !i.IsVariantTemplate)
            .ToDictionaryAsync(i => i.Id);
        if (requests.Any(r => !items.ContainsKey(r.ItemId))) throw Fail("PosItemNotFound");
        var prices = (await _prices.ResolveAsync(companyId, store.WarehouseId, DateOnly.FromDateTime(PosService.LocalTime(DateTime.UtcNow)),
            requests.Select(r => r.ItemId).Distinct().ToList(), store.PriceListId)).ToDictionary(p => p.ItemId, p => p.Price);

        var groupLinks = await _db.PosItemModifierGroups.AsNoTracking().Where(g => itemIds.Contains(g.ItemId)).ToListAsync();
        var groupIds = groupLinks.Select(g => g.GroupId).Distinct().ToList();
        var groups = await _db.PosModifierGroups.AsNoTracking().Include(g => g.Modifiers)
            .Where(g => groupIds.Contains(g.Id) && g.IsActive).ToDictionaryAsync(g => g.Id);
        var slots = await _db.PosComboSlots.AsNoTracking().Include(s => s.Choices).Where(s => itemIds.Contains(s.ComboItemId)).ToListAsync();

        var lineNo = tab.Lines.Count == 0 ? 0 : tab.Lines.Max(l => l.LineNo);
        foreach (var r in requests)
        {
            var item = items[r.ItemId];
            if (r.Quantity <= 0 || r.Quantity > 10_000) throw Fail("PosAmountInvalid");
            if (item.MinimumAge is > 0 && !r.AgeVerified && state != TabLineState.Requested) throw Fail("PosAgeNotVerified", item.Name, item.MinimumAge);
            decimal price;
            if (item.OpenPrice)
            {
                price = r.UnitPrice is >= 0 ? r.UnitPrice.Value : throw Fail("PosPriceRequired", item.Name);
            }
            else
            {
                price = prices.TryGetValue(item.Id, out var p) ? p : throw Fail("PosPriceMissing", item.Name);
            }

            // Modifiers: from the item's groups, within each group's min and max.
            var chosen = (r.ModifierIds ?? new()).Distinct().ToList();
            var offered = groupLinks.Where(g => g.ItemId == item.Id && groups.ContainsKey(g.GroupId)).Select(g => groups[g.GroupId]).ToList();
            var modifiers = new List<Modifier>();
            foreach (var id in chosen)
            {
                var modifier = offered.SelectMany(g => g.Modifiers).FirstOrDefault(m => m.Id == id && m.IsActive) ?? throw Fail("PosModifierInvalid", item.Name);
                modifiers.Add(modifier);
            }
            foreach (var g in offered)
            {
                var n = modifiers.Count(m => m.GroupId == g.Id);
                if (n < g.MinSelect || (g.MaxSelect > 0 && n > g.MaxSelect)) throw Fail("PosModifierCount", g.Name, item.Name);
            }
            price += modifiers.Sum(m => m.PriceDelta);

            // Combos: one choice per slot (within its min and max), each its own line at no price.
            var itemSlots = slots.Where(s => s.ComboItemId == item.Id).OrderBy(s => s.SortOrder).ToList();
            var choices = new List<(ComboSlot Slot, ComboChoice Choice)>();
            foreach (var c in r.ComboChoices ?? new())
            {
                var slot = itemSlots.FirstOrDefault(s => s.Id == c.SlotId) ?? throw Fail("PosComboInvalid", item.Name);
                var choice = slot.Choices.FirstOrDefault(x => x.ItemId == c.ItemId) ?? throw Fail("PosComboInvalid", item.Name);
                choices.Add((slot, choice));
            }
            foreach (var slot in itemSlots)
            {
                var n = choices.Count(c => c.Slot.Id == slot.Id);
                if (n < slot.MinSelect || (slot.MaxSelect > 0 && n > slot.MaxSelect)) throw Fail("PosComboCount", slot.Name, item.Name);
            }
            price += choices.Sum(c => c.Choice.PriceDelta);

            var line = new TabLine
            {
                Id = Guid.NewGuid(), TabId = tab.Id, LineNo = ++lineNo, ItemId = item.Id, Description = item.Name, Quantity = r.Quantity,
                UnitPrice = price, State = state, Seat = r.Seat, Course = Math.Max(1, r.Course), Note = Blank(r.Note),
                Modifiers = modifiers.Count == 0 ? null : string.Join(", ", modifiers.OrderBy(m => m.SortOrder).Select(m => m.Name)),
                ModifierIds = modifiers.Count == 0 ? null : string.Join(",", modifiers.Select(m => m.Id)),
                ProductionCenterId = item.ProductionCenterId,
            };
            tab.Lines.Add(line);
            _db.PosTabLines.Add(line);
            foreach (var (slot, choice) in choices)
            {
                var chosenItem = items[choice.ItemId];
                var child = new TabLine
                {
                    Id = Guid.NewGuid(), TabId = tab.Id, LineNo = ++lineNo, ItemId = chosenItem.Id, Description = $"{slot.Name}: {chosenItem.Name}",
                    Quantity = r.Quantity, UnitPrice = 0m, State = state, Seat = r.Seat, Course = line.Course, ParentLineId = line.Id,
                    ProductionCenterId = chosenItem.ProductionCenterId,
                };
                tab.Lines.Add(child);
                _db.PosTabLines.Add(child);
            }
        }
        tab.State = TabState.Open;
    }

    public void UpdateLine(Tab tab, TabLine line, UpdateTabLineRequest request)
    {
        if (!IsOpen(tab)) throw Fail("PosTabClosed");
        if (line.State != TabLineState.Pending) throw Fail("PosTabLineSent");
        if (request.Quantity <= 0 || request.Quantity > 10_000) throw Fail("PosAmountInvalid");
        (line.Quantity, line.Seat, line.Course, line.Note) = (request.Quantity, request.Seat, Math.Max(1, request.Course), Blank(request.Note));
        foreach (var child in tab.Lines.Where(l => l.ParentLineId == line.Id)) (child.Quantity, child.Seat, child.Course) = (request.Quantity, request.Seat, line.Course);
    }

    // Voiding a line already sent prints a STORNO ticket; the caller checks the manager's right.
    public async Task<List<KitchenTicket>> VoidLineAsync(Tab tab, TabLine line, string reason, Guid userId)
    {
        if (!IsOpen(tab)) throw Fail("PosTabClosed");
        if (string.IsNullOrWhiteSpace(reason)) throw Fail("PosReasonRequired");
        if (line.State == TabLineState.Voided) return new();
        if (line.PaidQuantity > 0) throw Fail("PosTabLinePaid");
        var lines = tab.Lines.Where(l => l.Id == line.Id || l.ParentLineId == line.Id).ToList();
        var sent = lines.Where(l => l.State == TabLineState.Sent).ToList();
        foreach (var l in lines)
        {
            (l.State, l.VoidReason, l.VoidedByUserId) = (TabLineState.Voided, reason.Trim(), userId);
        }
        return sent.Count == 0 ? new() : await TicketsAsync(tab, sent, storno: true);
    }

    // ---- Kitchen ----

    // Sends the pending lines (of one course, or all) to their production centres.
    public async Task<List<KitchenTicket>> SendAsync(Tab tab, int? course)
    {
        if (!IsOpen(tab)) throw Fail("PosTabClosed");
        var pending = tab.Lines.Where(l => l.State == TabLineState.Pending && (course is null || l.Course == course)).ToList();
        var now = DateTime.UtcNow;
        foreach (var l in pending) (l.State, l.SentAt) = (TabLineState.Sent, now);
        return await TicketsAsync(tab, pending, storno: false);
    }

    private async Task<List<KitchenTicket>> TicketsAsync(Tab tab, List<TabLine> lines, bool storno)
    {
        var tickets = new List<KitchenTicket>();
        var label = await TabLabelAsync(tab);
        var today = PosService.LocalTime(DateTime.UtcNow).Date;
        var dayStart = DateTime.SpecifyKind(today, DateTimeKind.Utc).AddHours(-2);
        foreach (var group in lines.Where(l => l.ProductionCenterId != null).GroupBy(l => l.ProductionCenterId))
        {
            // Numbered per production centre and day.
            var number = await _db.PosKitchenTickets.CountAsync(t => t.ProductionCenterId == group.Key && t.CreatedAt >= dayStart) + tickets.Count(t => t.ProductionCenterId == group.Key) + 1;
            var ticket = new KitchenTicket
            {
                Id = Guid.NewGuid(), CompanyId = tab.CompanyId, StoreId = tab.StoreId, TabId = tab.Id, ProductionCenterId = group.Key, Number = number,
                IsStorno = storno, State = KitchenTicketState.New, TabLabel = label, WaiterName = tab.WaiterName,
            };
            ticket.Lines = group.OrderBy(l => l.Course).ThenBy(l => l.LineNo).Select(l => new KitchenTicketLine
            {
                Id = Guid.NewGuid(), TicketId = ticket.Id, TabLineId = l.Id, Description = l.Description, Quantity = l.Quantity,
                Modifiers = l.Modifiers, Note = l.Note, Seat = l.Seat, Course = l.Course,
            }).ToList();
            _db.PosKitchenTickets.Add(ticket);
            tickets.Add(ticket);
        }
        return tickets;
    }

    private async Task<string> TabLabelAsync(Tab tab)
    {
        if (tab.TableId is { } tableId && await _db.PosTables.AsNoTracking().Where(t => t.Id == tableId).Select(t => t.Name).FirstOrDefaultAsync() is { } name)
        {
            return name;
        }
        return tab.Name ?? tab.Number;
    }

    // ---- Moving ----

    public async Task TransferAsync(Tab tab, Guid? tableId)
    {
        if (!IsOpen(tab)) throw Fail("PosTabClosed");
        if (tableId is { } id && !await _db.PosTables.AnyAsync(t => t.Id == id && t.IsActive && _db.PosFloors.Any(f => f.Id == t.FloorId && f.StoreId == tab.StoreId)))
        {
            throw Fail("PosTableNotFound");
        }
        tab.TableId = tableId;
    }

    // Moves unpaid lines (with their combo choices) to another open tab of the same store; a tab
    // left with nothing open is closed.
    public void MoveLines(Tab from, Tab to, IReadOnlyCollection<Guid> lineIds)
    {
        if (!IsOpen(from) || !IsOpen(to) || from.StoreId != to.StoreId || from.Id == to.Id) throw Fail("PosTabClosed");
        var moving = from.Lines.Where(l => lineIds.Contains(l.Id) || (l.ParentLineId is { } p && lineIds.Contains(p))).ToList();
        if (moving.Count == 0) throw Fail("PosOrderNoLines");
        if (moving.Any(l => l.PaidQuantity > 0)) throw Fail("PosTabLinePaid");
        var lineNo = to.Lines.Count == 0 ? 0 : to.Lines.Max(l => l.LineNo);
        foreach (var l in moving.OrderBy(l => l.LineNo))
        {
            from.Lines.Remove(l);
            l.TabId = to.Id;
            l.LineNo = ++lineNo;
            to.Lines.Add(l);
        }
        if (from.Lines.All(l => l.State == TabLineState.Voided || l.PaidQuantity >= l.Quantity))
        {
            from.State = from.Lines.Any(l => l.PaidQuantity > 0) ? TabState.Closed : TabState.Cancelled;
            from.ClosedAt = DateTime.UtcNow;
        }
        to.State = TabState.Open;
    }

    public void Cancel(Tab tab, Guid userId)
    {
        if (!IsOpen(tab)) throw Fail("PosTabClosed");
        if (tab.Lines.Any(l => l.PaidQuantity > 0)) throw Fail("PosTabLinePaid");
        if (tab.Lines.Any(l => l.State is TabLineState.Sent)) throw Fail("PosTabHasSentLines");
        foreach (var l in tab.Lines.Where(l => l.State != TabLineState.Voided))
        {
            (l.State, l.VoidReason, l.VoidedByUserId) = (TabLineState.Voided, "—", userId);
        }
        tab.State = TabState.Cancelled;
        tab.ClosedAt = DateTime.UtcNow;
    }

    // QR self-orders wait for a waiter: accepted lines become ordinary pending lines.
    public void AcceptRequested(Tab tab, Guid userId, bool accept)
    {
        foreach (var l in tab.Lines.Where(l => l.State == TabLineState.Requested))
        {
            if (accept) l.State = TabLineState.Pending;
            else (l.State, l.VoidReason, l.VoidedByUserId) = (TabLineState.Voided, "QR", userId);
        }
    }

    // ---- Paying ----

    // An equal split over N guests: each part takes Remaining / N of every open line (to 4
    // decimals), the last part what is left; each part is priced like the sale it will become.
    public async Task<TabSplitResponse> SplitAsync(Tab tab, int ways)
    {
        if (ways is < 2 or > 50) throw Fail("PosAmountInvalid");
        var open = tab.Lines.Where(l => l.State != TabLineState.Voided && l.State != TabLineState.Requested && l.Quantity > l.PaidQuantity)
            .OrderBy(l => l.LineNo).ToList();
        if (open.Count == 0) throw Fail("PosOrderNoLines");
        var tax = await LettersAsync(tab.CompanyId, open);
        var parts = new List<TabSplitPartResponse>();
        var given = open.ToDictionary(l => l.Id, _ => 0m);
        for (var part = 1; part <= ways; part++)
        {
            var lines = new List<TabSplitLineResponse>();
            foreach (var l in open)
            {
                var remaining = l.Quantity - l.PaidQuantity;
                var share = part == ways ? remaining - given[l.Id] : Math.Round(remaining / ways, 4, MidpointRounding.ToZero);
                given[l.Id] += share;
                if (share > 0) lines.Add(new TabSplitLineResponse(l.Id, share));
            }
            var priced = PosPricing.Compute(lines.Select(x =>
            {
                var l = open.First(o => o.Id == x.TabLineId);
                return new PosPricing.LineInput(x.Quantity, l.UnitPrice, DiscountShare(l, x.Quantity), tax[l.ItemId].Letter, tax[l.ItemId].Rate);
            }).ToList());
            parts.Add(new TabSplitPartResponse(part, lines, priced.Total));
        }
        return new TabSplitResponse(ways, parts);
    }

    // A line's discount, shared pro rata over the quantity paid.
    public static decimal DiscountShare(TabLine line, decimal quantity) =>
        line.DiscountAmount == 0 || line.Quantity == 0 ? 0m : PosPricing.Money(line.DiscountAmount * quantity / line.Quantity);

    // Records what an order paid of the tab and closes it when nothing is left.
    public static void ApplyPayment(Tab tab, IEnumerable<(Guid TabLineId, decimal Quantity)> paid, bool returned = false)
    {
        foreach (var (id, quantity) in paid)
        {
            var line = tab.Lines.First(l => l.Id == id);
            line.PaidQuantity += returned ? -quantity : quantity;
        }
        if (tab.Lines.Where(l => l.State != TabLineState.Voided && l.State != TabLineState.Requested).All(l => l.PaidQuantity >= l.Quantity))
        {
            tab.State = TabState.Closed;
            tab.ClosedAt = DateTime.UtcNow;
        }
    }

    // ---- Reading ----

    private async Task<Dictionary<Guid, (string Letter, decimal Rate)>> LettersAsync(Guid companyId, IEnumerable<TabLine> lines)
    {
        var itemIds = lines.Select(l => l.ItemId).Distinct().ToList();
        var items = await _db.Items.AsNoTracking().Where(i => itemIds.Contains(i.Id)).Select(i => new { i.Id, i.DefaultTaxDefinitionId }).ToListAsync();
        var taxIds = items.Where(i => i.DefaultTaxDefinitionId != null).Select(i => i.DefaultTaxDefinitionId!.Value).Distinct().ToList();
        var taxes = await _db.TaxDefinitions.AsNoTracking().Where(t => taxIds.Contains(t.Id)).ToDictionaryAsync(t => t.Id);
        return items.ToDictionary(i => i.Id, i =>
        {
            var tax = i.DefaultTaxDefinitionId is { } t ? taxes.GetValueOrDefault(t) : null;
            return (PosService.LetterFor(tax) ?? "E", tax?.Rate ?? 0m);
        });
    }

    public async Task<TabResponse> ToResponseAsync(Tab tab)
    {
        var tableName = tab.TableId is { } id ? await _db.PosTables.AsNoTracking().Where(t => t.Id == id).Select(t => t.Name).FirstOrDefaultAsync() : null;
        var lines = tab.Lines.OrderBy(l => l.LineNo).ToList();
        var counted = lines.Where(l => l.State is TabLineState.Pending or TabLineState.Sent).ToList();
        var tax = await LettersAsync(tab.CompanyId, lines);
        decimal Gross(TabLine l, decimal q) => PosPricing.Money(q * l.UnitPrice) - DiscountShare(l, q);
        var remaining = counted.Where(l => l.Quantity > l.PaidQuantity).ToList();
        var due = remaining.Count == 0 ? null : PosPricing.Compute(remaining.Select(l =>
            new PosPricing.LineInput(l.Quantity - l.PaidQuantity, l.UnitPrice, DiscountShare(l, l.Quantity - l.PaidQuantity), tax[l.ItemId].Letter, tax[l.ItemId].Rate)).ToList());
        var total = counted.Sum(l => Gross(l, l.Quantity));
        var whole = counted.Count == 0 ? null : PosPricing.Compute(counted.Select(l =>
            new PosPricing.LineInput(l.Quantity, l.UnitPrice, DiscountShare(l, l.Quantity), tax[l.ItemId].Letter, tax[l.ItemId].Rate)).ToList());
        return new TabResponse(tab.Id, tab.Number, tab.Name, tab.Kind, tab.State, tab.StoreId, tab.TableId, tableName, tab.Covers, tab.WaiterName, tab.OpenedAt,
            tab.DeliveryAddress, tab.DeliveryPhone, tab.DriverName, tab.PreBillCount,
            lines.Select(l => new TabLineResponse(l.Id, l.LineNo, l.ItemId, l.Description, l.Quantity, l.UnitPrice, l.DiscountAmount,
                l.State == TabLineState.Voided ? 0m : Gross(l, l.Quantity), l.State, l.Seat, l.Course, l.Note, l.Modifiers, l.ParentLineId,
                l.ProductionCenterId, l.SentAt, l.PaidQuantity, Math.Max(0m, l.Quantity - l.PaidQuantity),
                l.State is TabLineState.Pending or TabLineState.Sent ? Gross(l, Math.Max(0m, l.Quantity - l.PaidQuantity)) : 0m, l.VoidReason)).ToList(),
            due?.Taxes.Select(t => new ReportTaxRow(t.TaxLetter, t.TaxRate, t.Gross, t.Net, t.Tax)).ToList() ?? new(),
            total, total - (due?.Total ?? 0m), due?.Total ?? 0m,
            whole?.Taxes.Select(t => new ReportTaxRow(t.TaxLetter, t.TaxRate, t.Gross, t.Net, t.Tax)).ToList() ?? new());
    }

    public async Task<TabSummaryResponse> SummaryAsync(Tab tab, string? tableName)
    {
        var response = await ToResponseAsync(tab);
        return new TabSummaryResponse(tab.Id, tab.Number, tab.Name, tab.Kind, tab.State, tab.TableId, tableName, tab.Covers, tab.WaiterName, tab.OpenedAt,
            response.Total, response.Due, tab.Lines.Count(l => l.State == TabLineState.Pending), tab.Lines.Count(l => l.State == TabLineState.Requested));
    }

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
