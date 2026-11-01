using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Contracts;
using Pako.Domain.Companies;
using Pako.Domain.Inventory;
using Pako.Domain.Bills;
using Pako.Domain.Ledger;
using Pako.Domain.Tax;
using Pako.Infrastructure;

namespace Pako.Api.Services;

// docs/INVENTORY_PLAN.md §5.1 and §5.3 — opening stock, transfers, counts and write-offs. A document
// is a draft until posted; posting numbers it, moves the stock through StockService and, for
// everything except a transfer, writes one journal entry in the General journal.
public class StockDocumentService
{
    private const int AtkNoticeDays = 10;

    private readonly PakoDbContext _db;
    private readonly StockService _stock;
    private readonly NumberSeriesService _numbers;
    private readonly IStringLocalizer<ErrorMessages> _localizer;
    private readonly ITaxComputationService _tax;

    public StockDocumentService(PakoDbContext db, StockService stock, NumberSeriesService numbers, IStringLocalizer<ErrorMessages> localizer,
        ITaxComputationService tax)
    {
        _db = db;
        _stock = stock;
        _numbers = numbers;
        _localizer = localizer;
        _tax = tax;
    }

    public static string NumberSeriesKey(StockDocumentType type) => "Stock" + type;

    // ---- Drafts ----

    public async Task<StockDocument> SaveDraftAsync(Guid companyId, StockDocument? document, SaveStockDocumentRequest request)
    {
        if (document is { IsPosted: true }) throw new StockException(_localizer["StockDocumentPosted"].Value);
        await ValidateAsync(companyId, request);

        if (document is null)
        {
            document = new StockDocument { Id = Guid.NewGuid(), CompanyId = companyId, Type = request.Type };
            _db.StockDocuments.Add(document);
        }
        else if (document.Type != request.Type)
        {
            throw new StockException(_localizer["StockDocumentTypeFixed"].Value);
        }

        document.Date = request.Date;
        document.WarehouseId = request.WarehouseId;
        document.DestinationWarehouseId = request.Type == StockDocumentType.Transfer ? request.DestinationWarehouseId : null;
        document.Reason = request.Type == StockDocumentType.WriteOff ? request.Reason : null;
        document.AtkNoticeDate = request.Type == StockDocumentType.WriteOff ? request.AtkNoticeDate : null;
        document.Notes = string.IsNullOrWhiteSpace(request.Notes) ? null : request.Notes.Trim();
        document.PartnerId = request.Type is StockDocumentType.Receipt or StockDocumentType.Delivery ? request.PartnerId : null;
        document.SiteId = request.Type == StockDocumentType.SiteIssue ? request.SiteId : null;

        _db.StockDocumentLines.RemoveRange(document.Lines);
        document.Lines = request.Lines.Select(l => new StockDocumentLine
        {
            Id = Guid.NewGuid(),
            StockDocumentId = document.Id,
            ItemId = l.ItemId,
            // Write-down lines carry the net realisable value per unit; the quantity comes from the books.
            Quantity = request.Type == StockDocumentType.WriteDown ? 0m : l.Quantity,
            UnitCost = request.Type is StockDocumentType.Opening or StockDocumentType.WriteDown or StockDocumentType.Receipt ? l.UnitCost : null,
            PurchaseOrderLineId = request.Type == StockDocumentType.Receipt ? l.PurchaseOrderLineId : null,
            SalesOrderLineId = request.Type == StockDocumentType.Delivery ? l.SalesOrderLineId : null,
            CostCodeId = request.Type == StockDocumentType.SiteIssue ? l.CostCodeId : null,
            LotNumber = string.IsNullOrWhiteSpace(l.LotNumber) ? null : l.LotNumber.Trim(),
            ExpiryDate = l.ExpiryDate,
            Note = string.IsNullOrWhiteSpace(l.Note) ? null : l.Note.Trim(),
        }).ToList();
        _db.StockDocumentLines.AddRange(document.Lines);
        return document;
    }

    private async Task ValidateAsync(Guid companyId, SaveStockDocumentRequest request)
    {
        if (request.Lines is null || request.Lines.Count == 0) throw new StockException(_localizer["StockDocumentNoLines"].Value);
        if (request.Lines.Count > 2000) throw new StockException(_localizer["StockDocumentTooManyLines"].Value);

        var warehouses = await _db.Warehouses.AsNoTracking().Where(w => w.CompanyId == companyId && w.IsActive).Select(w => w.Id).ToListAsync();
        if (!warehouses.Contains(request.WarehouseId)) throw new StockException(_localizer["WarehouseNotFound"].Value);
        if (request.Type == StockDocumentType.Transfer &&
            (request.DestinationWarehouseId is not { } destination || !warehouses.Contains(destination) || destination == request.WarehouseId))
        {
            throw new StockException(_localizer["StockTransferWarehouses"].Value);
        }

        var itemIds = request.Lines.Select(l => l.ItemId).Distinct().ToList();
        var tracked = await _stock.TrackedItemsAsync(companyId, itemIds.Cast<Guid?>());
        var notTracked = itemIds.FirstOrDefault(id => !tracked.ContainsKey(id));
        if (notTracked != Guid.Empty)
        {
            var name = await _db.Items.AsNoTracking().Where(i => i.Id == notTracked).Select(i => i.Name).FirstOrDefaultAsync() ?? "?";
            throw new StockException(string.Format(_localizer["StockItemNotTracked"].Value, name));
        }
        // One line per item (a count with the same item twice would be ambiguous). A delivery may
        // send one item for two order lines, a site issue for two cost codes.
        if (request.Type is StockDocumentType.Delivery or StockDocumentType.SiteIssue
            ? request.Lines.Select(l => (l.ItemId, l.SalesOrderLineId, l.CostCodeId)).Distinct().Count() != request.Lines.Count
            : itemIds.Count != request.Lines.Count) throw new StockException(_localizer["StockDocumentDuplicateItem"].Value);

        foreach (var line in request.Lines)
        {
            if (request.Type == StockDocumentType.WriteDown)
            {
                if (line.UnitCost is not { } nrv || nrv < 0) throw new StockException(_localizer["StockWriteDownValueRequired"].Value);
                continue;
            }
            var minimum = request.Type == StockDocumentType.Count ? 0m : 0.0001m;
            if (line.Quantity < minimum || line.Quantity > 1_000_000_000m) throw new StockException(_localizer["StockDocumentQuantity"].Value);
            if (request.Type is StockDocumentType.Opening or StockDocumentType.Receipt && (line.UnitCost is not { } cost || cost < 0))
            {
                throw new StockException(_localizer["StockOpeningCostRequired"].Value);
            }
        }

        if (request.Type == StockDocumentType.Delivery) await ValidateDeliveryAsync(companyId, request);
        if (request.Type == StockDocumentType.SiteIssue)
        {
            // docs/ERP_VERTICALS_PLAN.md §1: an active site of this company; cost codes of that site.
            var site = request.SiteId is { } siteId
                ? await _db.ConstructionSites.AsNoTracking().Include(s => s.CostCodes)
                    .FirstOrDefaultAsync(s => s.Id == siteId && s.CompanyId == companyId && s.State == Pako.Domain.Projects.SiteState.Active)
                : null;
            if (site is null) throw new StockException(_localizer["SiteIssueSiteRequired"].Value);
            if (request.Lines.Any(l => l.CostCodeId is { } code && site.CostCodes.All(c => c.Id != code)))
            {
                throw new StockException(_localizer["SiteIssueCostCodeInvalid"].Value);
            }
        }

        if (request.Type == StockDocumentType.WriteOff && request.Reason is null)
        {
            throw new StockException(_localizer["StockWriteOffReasonRequired"].Value);
        }

        if (request.Type == StockDocumentType.Receipt)
        {
            if (request.PartnerId is not { } vendor
                || !await _db.Partners.AnyAsync(p => p.Id == vendor && p.CompanyId == companyId && p.IsVendor))
            {
                throw new StockException(_localizer["PurchaseOrderVendorRequired"].Value);
            }
            // An ordered line must be on a confirmed order from this vendor, for the same item.
            var orderLineIds = request.Lines.Where(l => l.PurchaseOrderLineId != null).Select(l => l.PurchaseOrderLineId!.Value).ToList();
            if (orderLineIds.Count > 0)
            {
                var orderLines = await _db.PurchaseOrderLines.AsNoTracking()
                    .Where(l => orderLineIds.Contains(l.Id) && l.PurchaseOrder!.CompanyId == companyId && l.PurchaseOrder.PartnerId == vendor
                        && l.PurchaseOrder.State == Pako.Domain.Bills.PurchaseOrderState.Confirmed)
                    .ToDictionaryAsync(l => l.Id, l => l.ItemId);
                if (request.Lines.Any(l => l.PurchaseOrderLineId is { } id && (!orderLines.TryGetValue(id, out var item) || item != l.ItemId)))
                {
                    throw new StockException(_localizer["BillPurchaseOrderLineInvalid"].Value);
                }
            }
        }
    }

    // docs/POS_PLAN.md P6: a delivery goes to a customer; an ordered line must be on a confirmed
    // order of that customer, for the same item.
    private async Task ValidateDeliveryAsync(Guid companyId, SaveStockDocumentRequest request)
    {
        if (request.PartnerId is not { } customer
            || !await _db.Partners.AnyAsync(p => p.Id == customer && p.CompanyId == companyId && p.IsCustomer))
        {
            throw new StockException(_localizer["DeliveryCustomerRequired"].Value);
        }
        var orderLineIds = request.Lines.Where(l => l.SalesOrderLineId != null).Select(l => l.SalesOrderLineId!.Value).ToList();
        if (orderLineIds.Count == 0) return;
        var orderLines = await _db.SalesOrderLines.AsNoTracking()
            .Where(l => orderLineIds.Contains(l.Id) && l.SalesOrder!.CompanyId == companyId && l.SalesOrder.PartnerId == customer
                && l.SalesOrder.State == Pako.Domain.Invoicing.SalesOrderState.Confirmed)
            .ToDictionaryAsync(l => l.Id, l => l.ItemId);
        if (request.Lines.Any(l => l.SalesOrderLineId is { } id && (!orderLines.TryGetValue(id, out var item) || item != l.ItemId)))
        {
            throw new StockException(_localizer["DeliveryOrderLineInvalid"].Value);
        }
    }

    // A delivery against an order can't send more than the order still waits for.
    private async Task CheckOrderNotOverDeliveredAsync(StockDocument document)
    {
        var byLine = document.Lines.Where(l => l.SalesOrderLineId != null)
            .GroupBy(l => l.SalesOrderLineId!.Value).ToDictionary(g => g.Key, g => g.Sum(l => l.Quantity));
        if (byLine.Count == 0) return;
        var ordered = await _db.SalesOrderLines.AsNoTracking().Where(l => byLine.Keys.Contains(l.Id))
            .Select(l => new { l.Id, Quantity = l.Quantity * l.UnitFactor, l.Description }).ToDictionaryAsync(l => l.Id);
        var delivered = await SalesOrderQuantities.DeliveredAsync(_db, byLine.Keys.ToList(), exceptDocumentId: document.Id);
        foreach (var (lineId, quantity) in byLine)
        {
            if (!ordered.TryGetValue(lineId, out var line)) continue;
            var open = Math.Max(0m, line.Quantity - delivered.GetValueOrDefault(lineId));
            if (quantity > open) throw new StockException(string.Format(_localizer["SalesOrderOverDelivered"].Value, line.Description, open));
        }
    }

    // ---- Posting ----

    // §12 P6: a receipt against an order can't bring in more than the order still waits for — goods a
    // bill already brought in directly (or another receipt) are on the shelf, and a second receipt
    // would count them twice and leave 120800 open with no bill to clear it. Extra goods the vendor
    // sent go on a receipt without the order link.
    private async Task CheckOrderNotOverReceivedAsync(StockDocument document)
    {
        var byLine = document.Lines.Where(l => l.PurchaseOrderLineId != null)
            .GroupBy(l => l.PurchaseOrderLineId!.Value).ToDictionary(g => g.Key, g => g.Sum(l => l.Quantity));
        if (byLine.Count == 0) return;
        var ordered = await _db.PurchaseOrderLines.AsNoTracking().Where(l => byLine.Keys.Contains(l.Id))
            .Select(l => new { l.Id, l.Quantity, l.Description }).ToDictionaryAsync(l => l.Id);
        var received = await PurchaseOrderQuantities.ReceivedAsync(_db, byLine.Keys.ToList(), exceptDocumentId: document.Id);
        foreach (var (lineId, quantity) in byLine)
        {
            if (!ordered.TryGetValue(lineId, out var line)) continue;
            var open = Math.Max(0m, line.Quantity - received.GetValueOrDefault(lineId));
            if (quantity > open) throw new StockException(string.Format(_localizer["PurchaseOrderOverReceived"].Value, line.Description, open));
        }
    }

    public async Task PostAsync(Company company, StockDocument document, Guid userId)
    {
        if (document.IsPosted) throw new StockException(_localizer["StockDocumentPosted"].Value);
        await ValidateAsync(company.Id, new SaveStockDocumentRequest(document.Type, document.Date, document.WarehouseId,
            document.Lines.Select(l => new StockDocumentLineRequest(l.ItemId, l.Quantity, l.UnitCost, l.Note, l.PurchaseOrderLineId, l.LotNumber, l.ExpiryDate,
                l.SalesOrderLineId, l.CostCodeId)).ToList(),
            document.DestinationWarehouseId, document.Reason, document.AtkNoticeDate, document.Notes, document.PartnerId, document.SiteId));

        // D14 (AI 03/2015 Art. 61.2): destroying expired or damaged goods needs written notice to ATK
        // at least 10 days before.
        if (document.Type == StockDocumentType.WriteOff && document.Reason is WriteOffReason.Expired or WriteOffReason.Damaged)
        {
            if (document.AtkNoticeDate is not { } notice) throw new StockException(_localizer["StockWriteOffAtkNoticeRequired"].Value);
            if (document.Date < notice.AddDays(AtkNoticeDays))
            {
                throw new StockException(string.Format(_localizer["StockWriteOffAtkNoticeTooRecent"].Value, notice.AddDays(AtkNoticeDays)));
            }
        }

        if (document.Type == StockDocumentType.Receipt) await CheckOrderNotOverReceivedAsync(document);
        if (document.Type == StockDocumentType.Delivery) await CheckOrderNotOverDeliveredAsync(document);

        var effectiveCompany = await AccountLockService.GetEffectiveCompanyAsync(_db, company, userId);
        var location = await _stock.StockLocationAsync(company.Id, document.WarehouseId);
        var items = await _db.Items.AsNoTracking().Where(i => document.Lines.Select(l => l.ItemId).Contains(i.Id)).ToDictionaryAsync(i => i.Id);
        var accounts = await _stock.AccountsForAsync(company.Id, items.Values);

        var requests = new List<StockService.MoveRequest>();
        switch (document.Type)
        {
            case StockDocumentType.Opening:
                {
                    var opening = await _stock.VirtualLocationAsync(company.Id, LocationUsage.Opening);
                    foreach (var line in document.Lines)
                    {
                        requests.Add(new(line.ItemId, StockMoveKind.Receipt, opening.Id, location.Id, line.Quantity,
                            AverageCost.Money(line.Quantity * line.UnitCost!.Value), line.Id, line.LotNumber, line.ExpiryDate));
                    }
                    break;
                }
            case StockDocumentType.Receipt:
                {
                    var supplier = await _stock.VirtualLocationAsync(company.Id, LocationUsage.Supplier);
                    foreach (var line in document.Lines)
                    {
                        requests.Add(new(line.ItemId, StockMoveKind.Receipt, supplier.Id, location.Id, line.Quantity,
                            AverageCost.Money(line.Quantity * line.UnitCost!.Value), line.Id, line.LotNumber, line.ExpiryDate));
                    }
                    break;
                }
            case StockDocumentType.Transfer:
                {
                    var destination = await _stock.StockLocationAsync(company.Id, document.DestinationWarehouseId!.Value);
                    foreach (var line in document.Lines)
                    {
                        requests.Add(new(line.ItemId, StockMoveKind.Transfer, location.Id, destination.Id, line.Quantity, SourceLineId: line.Id,
                            LotNumber: line.LotNumber));
                    }
                    break;
                }
            case StockDocumentType.Count:
                {
                    var adjustment = await _stock.VirtualLocationAsync(company.Id, LocationUsage.Adjustment);
                    var book = await _stock.QuantitiesAtAsync(location.Id, document.Lines.Select(l => l.ItemId).ToList(), document.Date);
                    foreach (var line in document.Lines)
                    {
                        line.BookQuantity = book.GetValueOrDefault(line.ItemId);
                        line.Difference = line.Quantity - line.BookQuantity;
                        if (line.Difference > 0)
                            requests.Add(new(line.ItemId, StockMoveKind.Receipt, adjustment.Id, location.Id, line.Difference.Value, SourceLineId: line.Id,
                                LotNumber: line.LotNumber, ExpiryDate: line.ExpiryDate));
                        else if (line.Difference < 0)
                            requests.Add(new(line.ItemId, StockMoveKind.Issue, location.Id, adjustment.Id, -line.Difference.Value, SourceLineId: line.Id,
                                LotNumber: line.LotNumber));
                    }
                    break;
                }
            case StockDocumentType.SiteIssue:
                {
                    // Consumed on the site: out of stock for good, like scrap but charged to the project.
                    var consumed = await _stock.VirtualLocationAsync(company.Id, LocationUsage.Scrap);
                    foreach (var line in document.Lines)
                    {
                        requests.Add(new(line.ItemId, StockMoveKind.Issue, location.Id, consumed.Id, line.Quantity, SourceLineId: line.Id,
                            LotNumber: line.LotNumber));
                    }
                    break;
                }
            case StockDocumentType.Delivery:
                {
                    var customer = await _stock.VirtualLocationAsync(company.Id, LocationUsage.Customer);
                    foreach (var line in document.Lines)
                    {
                        requests.Add(new(line.ItemId, StockMoveKind.Issue, location.Id, customer.Id, line.Quantity, SourceLineId: line.Id,
                            LotNumber: line.LotNumber));
                    }
                    break;
                }
            case StockDocumentType.WriteOff:
                {
                    var scrap = await _stock.VirtualLocationAsync(company.Id, LocationUsage.Scrap);
                    foreach (var line in document.Lines)
                    {
                        requests.Add(new(line.ItemId, StockMoveKind.Issue, location.Id, scrap.Id, line.Quantity, SourceLineId: line.Id,
                            LotNumber: line.LotNumber));
                    }
                    break;
                }
        }

        document.Number = await _numbers.ReserveNextAsync(company.Id, NumberSeriesKey(document.Type), document.Date);
        if (document.Type == StockDocumentType.WriteDown)
        {
            if (await WriteDownEntryAsync(company.Id, document) is { } writeDown)
            {
                writeDown.Post(effectiveCompany);
                writeDown.PostedByUserId = userId;
                writeDown.SourceDocumentId = document.Id;
                _db.JournalEntries.Add(writeDown);
                document.JournalEntryId = writeDown.Id;
            }
            document.State = StockDocumentState.Posted;
            document.PostedAt = DateTime.UtcNow;
            document.PostedByUserId = userId;
            return;
        }

        var posting = await _stock.ApplyAsync(company.Id, document.Date, StockMoveSource.StockDocument, document.Id, document.Number, requests);

        if (document.Type != StockDocumentType.Transfer && posting.Moves.Count > 0
            && await JournalEntryAsync(company.Id, document, posting, accounts) is { } entry)
        {
            entry.Post(effectiveCompany);
            entry.PostedByUserId = userId;
            entry.SourceDocumentId = document.Id;
            _db.JournalEntries.Add(entry);
            document.JournalEntryId = entry.Id;
        }

        document.State = StockDocumentState.Posted;
        document.PostedAt = DateTime.UtcNow;
        document.PostedByUserId = userId;
    }

    // Phase 2 write-down to net realisable value. Each item's allowance is brought to
    // quantity × (average cost − NRV) at the document date, floored at zero; the change from the
    // allowance it already carries is posted Dr 520300 / Cr 120900 (a negative change reverses it).
    // A write-down can't be dated before a later one already posted for the same item, so the
    // allowance always follows the documents in date order.
    private async Task<JournalEntry?> WriteDownEntryAsync(Guid companyId, StockDocument document)
    {
        var itemIds = document.Lines.Select(l => l.ItemId).ToList();
        var positions = await _db.StockMoves.AsNoTracking()
            .Where(m => m.CompanyId == companyId && itemIds.Contains(m.ItemId) && m.Date <= document.Date)
            .GroupBy(m => m.ItemId)
            .Select(g => g.OrderByDescending(m => m.Date).ThenByDescending(m => m.Sequence).First())
            .ToDictionaryAsync(m => m.ItemId, m => new { m.QtyAfter, m.AvgCostAfter });
        var previous = await _db.StockDocumentLines.AsNoTracking()
            .Where(l => itemIds.Contains(l.ItemId) && l.StockDocument!.CompanyId == companyId && l.StockDocument.Type == StockDocumentType.WriteDown
                && l.StockDocument.State == StockDocumentState.Posted && l.StockDocumentId != document.Id)
            .Select(l => new { l.ItemId, l.StockDocument!.Date, l.StockDocument.PostedAt, l.AllowanceAfter })
            .ToListAsync();
        if (previous.Any(p => p.Date > document.Date))
        {
            throw new StockException(_localizer["StockWriteDownLaterExists"].Value);
        }

        var expense = await _stock.RequiredAccountAsync(companyId, StockService.ScrapAccountCode);
        var allowance = await _stock.RequiredAccountAsync(companyId, StockService.WriteDownAllowanceCode);
        var journal = await JournalResolver.GetAsync(_db, companyId, JournalType.General)
            ?? throw new StockException(_localizer["NoJournalToPost"].Value);
        var entry = new JournalEntry
        {
            Id = Guid.NewGuid(), CompanyId = companyId, JournalId = journal.Id, Date = document.Date,
            Reference = document.Number, Remarks = document.Notes,
        };
        var label = $"{_localizer["StockDocumentWriteDown"].Value} {document.Number}";
        foreach (var line in document.Lines)
        {
            var position = positions.GetValueOrDefault(line.ItemId);
            var quantity = position?.QtyAfter ?? 0m;
            var average = position?.AvgCostAfter ?? 0m;
            var current = previous.Where(p => p.ItemId == line.ItemId)
                .OrderByDescending(p => p.Date).ThenByDescending(p => p.PostedAt).Select(p => p.AllowanceAfter).FirstOrDefault() ?? 0m;
            var target = quantity > 0 ? AverageCost.Money(quantity * Math.Max(0m, average - line.UnitCost!.Value)) : 0m;
            line.BookQuantity = quantity;
            line.AverageCost = average;
            line.AllowanceAfter = target;
            line.Amount = target - current;
            StockService.AddPair(entry, expense, allowance, line.Amount.Value, label);
        }

        if (entry.Lines.Count == 0) return null;
        entry.SequenceNumber = JournalSequencer.ReserveNext(journal);
        return entry;
    }

    // Null when everything moved was worth nothing (items with no cost): no entry to post.
    private async Task<JournalEntry?> JournalEntryAsync(Guid companyId, StockDocument document, StockService.StockPosting posting,
        IReadOnlyDictionary<Guid, StockService.ItemAccounts> accounts)
    {
        var journal = await JournalResolver.GetAsync(_db, companyId, JournalType.General)
            ?? throw new StockException(_localizer["NoJournalToPost"].Value);
        var entry = new JournalEntry
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            JournalId = journal.Id,
            Date = document.Date,
            Reference = document.Number,
            Remarks = document.Notes,
        };
        var label = $"{_localizer["StockDocument" + document.Type].Value} {document.Number}";

        switch (document.Type)
        {
            case StockDocumentType.Opening:
                {
                    // D3: the clearing account takes the other side and must end at zero once every
                    // opening balance is in.
                    var clearing = await _stock.OpeningClearingAccountAsync(companyId);
                    foreach (var m in posting.Moves)
                    {
                        StockService.AddPair(entry, accounts[m.Request.ItemId].InventoryAccountId, clearing, m.Value, label);
                    }
                    break;
                }
            case StockDocumentType.Receipt:
                {
                    // §12 P6: Dr stock / Cr 120800 until the vendor's bill matches the receipt.
                    var grni = await _stock.RequiredAccountAsync(companyId, StockService.GoodsReceivedNotInvoicedCode);
                    foreach (var m in posting.Moves)
                    {
                        StockService.AddPair(entry, accounts[m.Request.ItemId].InventoryAccountId, grni, m.Value, label);
                    }
                    break;
                }
            case StockDocumentType.SiteIssue:
                {
                    // docs/ERP_VERTICALS_PLAN.md §1: Dr cost of sales (tagged with the site's project) / Cr stock.
                    foreach (var m in posting.Moves)
                    {
                        var a = accounts[m.Request.ItemId];
                        StockService.AddPair(entry, a.CogsAccountId, a.InventoryAccountId, m.Value, label);
                    }
                    break;
                }
            case StockDocumentType.Delivery:
                {
                    // docs/POS_PLAN.md P6: cost of goods sold on delivery; the invoice posts revenue only.
                    foreach (var m in posting.Moves)
                    {
                        var a = accounts[m.Request.ItemId];
                        StockService.AddPair(entry, a.CogsAccountId, a.InventoryAccountId, m.Value, label);
                    }
                    break;
                }
            case StockDocumentType.Count:
                {
                    var shortage = await _stock.RequiredAccountAsync(companyId, StockService.ShortageAccountCode);
                    var overage = await _stock.RequiredAccountAsync(companyId, StockService.OverageAccountCode);
                    foreach (var m in posting.Moves)
                    {
                        var inventory = accounts[m.Request.ItemId].InventoryAccountId;
                        if (m.Request.Kind == StockMoveKind.Receipt) StockService.AddPair(entry, inventory, overage, m.Value, label);
                        else StockService.AddPair(entry, shortage, inventory, m.Value, label);
                    }
                    break;
                }
            case StockDocumentType.WriteOff:
                {
                    // Theft and unexplained losses are shortages (input VAT goes back, Art. 61–62);
                    // expired, damaged, destroyed goods are write-offs.
                    var code = document.Reason is WriteOffReason.Theft or WriteOffReason.Unexplained
                        ? StockService.ShortageAccountCode : StockService.ScrapAccountCode;
                    var expense = await _stock.RequiredAccountAsync(companyId, code);
                    foreach (var m in posting.Moves)
                    {
                        StockService.AddPair(entry, expense, accounts[m.Request.ItemId].InventoryAccountId, m.Value, label);
                    }
                    // Only a VAT-registered company deducted input VAT to give back.
                    if (VatRepaymentDue(document) && await _db.Companies.AnyAsync(c => c.Id == companyId && c.IsVatRegistered))
                    {
                        await AddVatRepaymentAsync(entry, companyId, posting.Moves.Select(m => (m.Request.ItemId, m.Value)), expense,
                            $"{_localizer["StockVatRepayment"].Value} {document.Number}");
                    }
                    break;
                }
        }

        StockService.AddCorrections(entry, posting, accounts, posting.Moves.Select(m => (m.Request.ItemId, m.Correction)),
            _localizer["StockCostCorrection"].Value);
        if (document.Type == StockDocumentType.SiteIssue)
        {
            // The cost lands on the site's project.
            var projectId = await _db.ConstructionSites.AsNoTracking().Where(s => s.Id == document.SiteId).Select(s => s.ProjectId).FirstAsync();
            var cogs = accounts.Values.Select(a => a.CogsAccountId).ToHashSet();
            foreach (var line in entry.Lines.Where(l => cogs.Contains(l.AccountId))) line.ProjectId = projectId;
        }
        if (entry.Lines.Count == 0) return null;
        entry.SequenceNumber = JournalSequencer.ReserveNext(journal);
        return entry;
    }

    // D14 phase 2 (AI 03/2015 Arts. 61.1.4 and 62): goods stolen or lost without explanation lose the
    // input VAT deducted on them. It is reversed in the write-off's own entry — Dr shortage / Cr the
    // input VAT account, tagged with the tax code deducted on the item's latest purchase bill (B18 when
    // it was never bought on a bill) — so the VAT return of the write-off's month shows less input VAT.
    // Only deductible input VAT (113xxx other than 113900) is reversed; non-deductible VAT was never
    // claimed. The amount is the tax code's own computation on the cost written off.
    private async Task AddVatRepaymentAsync(JournalEntry entry, Guid companyId, IEnumerable<(Guid ItemId, decimal Value)> moved,
        Guid expenseAccountId, string label)
    {
        var lost = moved.Where(m => m.Value > 0).ToList();
        if (lost.Count == 0) return;
        var itemIds = lost.Select(m => m.ItemId).Distinct().ToList();
        var lastTax = (await _db.BillLines.AsNoTracking()
                .Where(l => l.ItemId != null && itemIds.Contains(l.ItemId.Value) && l.TaxDefinitionId != null && l.Bill!.CompanyId == companyId
                    && l.Bill.State == BillState.Posted && l.Bill.DocumentType == Pako.Domain.Bills.DocumentType.Bill)
                .Select(l => new { ItemId = l.ItemId!.Value, TaxId = l.TaxDefinitionId!.Value, l.Bill!.IssueDate, l.Bill.CreatedAt })
                .ToListAsync())
            .GroupBy(x => x.ItemId)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(x => x.IssueDate).ThenByDescending(x => x.CreatedAt).First().TaxId);
        var taxes = await _db.TaxDefinitions.AsNoTracking().Include(t => t.RepartitionLines).Where(t => t.CompanyId == companyId).ToListAsync();
        var fallback = taxes.FirstOrDefault(t => t.Code == "B18");
        var deductible = (await _db.Accounts.AsNoTracking()
            .Where(a => a.CompanyId == companyId && a.Code.StartsWith("113") && a.Code != "113900")
            .Select(a => a.Id).ToListAsync()).ToHashSet();

        foreach (var (itemId, value) in lost)
        {
            var tax = lastTax.TryGetValue(itemId, out var taxId) ? taxes.FirstOrDefault(t => t.Id == taxId) : fallback;
            if (tax is null || tax.IsReverseCharge || tax.DeductiblePercent is null or 0) continue;
            foreach (var line in _tax.Compute(value, tax).PostingLines.Where(p => deductible.Contains(p.AccountId) && p.Amount > 0))
            {
                entry.Lines.Add(new JournalEntryLine { Id = Guid.NewGuid(), AccountId = expenseAccountId, Debit = line.Amount, Description = label });
                entry.Lines.Add(new JournalEntryLine { Id = Guid.NewGuid(), AccountId = line.AccountId, Credit = line.Amount, Description = label, TaxId = tax.Id });
            }
        }
    }

    public static bool VatRepaymentDue(StockDocument d) =>
        d.Type == StockDocumentType.WriteOff && d.Reason is WriteOffReason.Theft or WriteOffReason.Unexplained;

    // ---- Reading ----

    public async Task<StockDocumentResponse> ToResponseAsync(StockDocument d)
    {
        var itemIds = d.Lines.Select(l => l.ItemId).ToList();
        var items = await _db.Items.AsNoTracking().Where(i => itemIds.Contains(i.Id)).ToDictionaryAsync(i => i.Id);
        var warehouseIds = new[] { d.WarehouseId, d.DestinationWarehouseId ?? Guid.Empty };
        var warehouses = await _db.Warehouses.AsNoTracking().Where(w => warehouseIds.Contains(w.Id)).ToDictionaryAsync(w => w.Id, w => w.Name);
        var values = d.IsPosted
            ? await _db.StockMoves.AsNoTracking().Where(m => m.SourceType == StockMoveSource.StockDocument && m.SourceId == d.Id)
                .GroupBy(m => m.SourceLineId).Select(g => new { g.Key, Value = g.Sum(m => m.Value) }).ToDictionaryAsync(g => g.Key ?? Guid.Empty, g => g.Value)
            : new Dictionary<Guid, decimal>();
        // Receipts: how much of each line vendor bills have matched (§12 P6).
        var lineIds = d.Lines.Select(l => l.Id).ToList();
        // Deliveries: how much of each line posted invoices have billed (docs/POS_PLAN.md P6).
        var billed = d.Type == StockDocumentType.Receipt
            ? await _db.ReceiptMatches.AsNoTracking().Where(m => lineIds.Contains(m.ReceiptLineId))
                .GroupBy(m => m.ReceiptLineId).Select(g => new { g.Key, Quantity = g.Sum(m => m.Quantity) }).ToDictionaryAsync(g => g.Key, g => g.Quantity)
            : d.Type == StockDocumentType.Delivery && d.IsPosted
                ? await SalesOrderQuantities.InvoicedDeliveriesAsync(_db, lineIds)
                : new Dictionary<Guid, decimal>();
        var partnerName = d.PartnerId is { } partnerId
            ? await _db.Partners.AsNoTracking().Where(p => p.Id == partnerId).Select(p => p.Name).FirstOrDefaultAsync()
            : null;
        // The input VAT reversed by a theft or unexplained-loss write-off (its tax-coded lines).
        decimal? vatRepaid = VatRepaymentDue(d) && d.JournalEntryId is { } entryId
            ? await _db.JournalEntryLines.AsNoTracking().Where(l => l.JournalEntryId == entryId && l.TaxId != null).SumAsync(l => l.Credit)
            : null;
        var lines = d.Lines.OrderBy(l => items.GetValueOrDefault(l.ItemId)?.Code ?? 0).Select(l =>
        {
            var item = items.GetValueOrDefault(l.ItemId);
            return new StockDocumentLineResponse(l.Id, l.ItemId, item?.Code ?? 0, item?.Name ?? "?", item?.Unit ?? string.Empty,
                l.Quantity, l.UnitCost, l.BookQuantity, l.Difference,
                !d.IsPosted ? null : d.Type == StockDocumentType.WriteDown ? l.Amount : values.GetValueOrDefault(l.Id), l.Note,
                l.AverageCost, l.AllowanceAfter, l.PurchaseOrderLineId,
                d.Type is StockDocumentType.Receipt or StockDocumentType.Delivery ? billed.GetValueOrDefault(l.Id) : null, l.LotNumber, l.ExpiryDate,
                l.SalesOrderLineId, l.CostCodeId);
        }).ToList();
        var total = d.Type == StockDocumentType.WriteDown ? d.Lines.Sum(l => l.Amount ?? 0m) : values.Values.Sum();
        return new StockDocumentResponse(d.Id, d.Type, d.State, d.Number, d.Date, d.WarehouseId, warehouses.GetValueOrDefault(d.WarehouseId) ?? "?",
            d.DestinationWarehouseId, d.DestinationWarehouseId is { } dest ? warehouses.GetValueOrDefault(dest) : null,
            d.Reason, d.AtkNoticeDate, d.Notes, total, VatRepaymentDue(d), d.JournalEntryId, d.PostedAt, lines, vatRepaid,
            d.PartnerId, partnerName, d.SiteId);
    }
}
