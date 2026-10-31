using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Contracts;
using Pako.Domain.Companies;
using Pako.Domain.Inventory;
using Pako.Domain.Ledger;
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

    public StockDocumentService(PakoDbContext db, StockService stock, NumberSeriesService numbers, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _stock = stock;
        _numbers = numbers;
        _localizer = localizer;
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

        _db.StockDocumentLines.RemoveRange(document.Lines);
        document.Lines = request.Lines.Select(l => new StockDocumentLine
        {
            Id = Guid.NewGuid(),
            StockDocumentId = document.Id,
            ItemId = l.ItemId,
            Quantity = l.Quantity,
            UnitCost = request.Type == StockDocumentType.Opening ? l.UnitCost : null,
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
        // One line per item (a count with the same item twice would be ambiguous).
        if (itemIds.Count != request.Lines.Count) throw new StockException(_localizer["StockDocumentDuplicateItem"].Value);

        foreach (var line in request.Lines)
        {
            var minimum = request.Type == StockDocumentType.Count ? 0m : 0.0001m;
            if (line.Quantity < minimum || line.Quantity > 1_000_000_000m) throw new StockException(_localizer["StockDocumentQuantity"].Value);
            if (request.Type == StockDocumentType.Opening && (line.UnitCost is not { } cost || cost < 0))
            {
                throw new StockException(_localizer["StockOpeningCostRequired"].Value);
            }
        }

        if (request.Type == StockDocumentType.WriteOff && request.Reason is null)
        {
            throw new StockException(_localizer["StockWriteOffReasonRequired"].Value);
        }
    }

    // ---- Posting ----

    public async Task PostAsync(Company company, StockDocument document, Guid userId)
    {
        if (document.IsPosted) throw new StockException(_localizer["StockDocumentPosted"].Value);
        await ValidateAsync(company.Id, new SaveStockDocumentRequest(document.Type, document.Date, document.WarehouseId,
            document.Lines.Select(l => new StockDocumentLineRequest(l.ItemId, l.Quantity, l.UnitCost, l.Note)).ToList(),
            document.DestinationWarehouseId, document.Reason, document.AtkNoticeDate, document.Notes));

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
                            AverageCost.Money(line.Quantity * line.UnitCost!.Value), line.Id));
                    }
                    break;
                }
            case StockDocumentType.Transfer:
                {
                    var destination = await _stock.StockLocationAsync(company.Id, document.DestinationWarehouseId!.Value);
                    foreach (var line in document.Lines)
                    {
                        requests.Add(new(line.ItemId, StockMoveKind.Transfer, location.Id, destination.Id, line.Quantity, SourceLineId: line.Id));
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
                            requests.Add(new(line.ItemId, StockMoveKind.Receipt, adjustment.Id, location.Id, line.Difference.Value, SourceLineId: line.Id));
                        else if (line.Difference < 0)
                            requests.Add(new(line.ItemId, StockMoveKind.Issue, location.Id, adjustment.Id, -line.Difference.Value, SourceLineId: line.Id));
                    }
                    break;
                }
            case StockDocumentType.WriteOff:
                {
                    var scrap = await _stock.VirtualLocationAsync(company.Id, LocationUsage.Scrap);
                    foreach (var line in document.Lines)
                    {
                        requests.Add(new(line.ItemId, StockMoveKind.Issue, location.Id, scrap.Id, line.Quantity, SourceLineId: line.Id));
                    }
                    break;
                }
        }

        document.Number = await _numbers.ReserveNextAsync(company.Id, NumberSeriesKey(document.Type), document.Date);
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
                    break;
                }
        }

        StockService.AddCorrections(entry, posting, accounts, posting.Moves.Select(m => (m.Request.ItemId, m.Correction)),
            _localizer["StockCostCorrection"].Value);
        if (entry.Lines.Count == 0) return null;
        entry.SequenceNumber = JournalSequencer.ReserveNext(journal);
        return entry;
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
        var lines = d.Lines.OrderBy(l => items.GetValueOrDefault(l.ItemId)?.Code ?? 0).Select(l =>
        {
            var item = items.GetValueOrDefault(l.ItemId);
            return new StockDocumentLineResponse(l.Id, l.ItemId, item?.Code ?? 0, item?.Name ?? "?", item?.Unit ?? string.Empty,
                l.Quantity, l.UnitCost, l.BookQuantity, l.Difference, d.IsPosted ? values.GetValueOrDefault(l.Id) : null, l.Note);
        }).ToList();
        return new StockDocumentResponse(d.Id, d.Type, d.State, d.Number, d.Date, d.WarehouseId, warehouses.GetValueOrDefault(d.WarehouseId) ?? "?",
            d.DestinationWarehouseId, d.DestinationWarehouseId is { } dest ? warehouses.GetValueOrDefault(dest) : null,
            d.Reason, d.AtkNoticeDate, d.Notes, values.Values.Sum(), VatRepaymentDue(d), d.JournalEntryId, d.PostedAt, lines);
    }
}
