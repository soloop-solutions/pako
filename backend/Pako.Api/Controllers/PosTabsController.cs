using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Hubs;
using Pako.Api.Services;
using Pako.Domain.Hr;
using Pako.Domain.Pos;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

// docs/POS_PLAN.md P3: floors and tables (Pos: Approve sets them up), tabs (Pos: Write — waiters
// open, order, send, move and pre-bill; voiding what the kitchen already has needs Approve) and
// the kitchen screen (Pos: Write bumps tickets).
[ApiController]
[Route("api/companies/{companyId:guid}/pos")]
[Authorize]
public class PosTabsController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly TabService _tabs;
    private readonly PosNotifier _notify;
    private readonly IStringLocalizer<ErrorMessages> _localizer;
    private readonly CompanyAccessContext _access;

    private readonly PosOperatorService _operators;

    public PosTabsController(PakoDbContext db, TabService tabs, PosNotifier notify, IStringLocalizer<ErrorMessages> localizer, CompanyAccessContext access,
        PosOperatorService operators)
    {
        _db = db;
        _tabs = tabs;
        _notify = notify;
        _localizer = localizer;
        _access = access;
        _operators = operators;
    }

    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    // ---- Floors and tables ----

    [HttpGet("floors", Name = "ListPosFloors")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<List<FloorResponse>>> Floors(Guid companyId, [FromQuery] Guid? storeId = null)
    {
        var query = _db.PosFloors.AsNoTracking().Include(f => f.Tables).Where(f => f.CompanyId == companyId);
        if (storeId is { } s) query = query.Where(f => f.StoreId == s);
        var floors = await query.OrderBy(f => f.SortOrder).ThenBy(f => f.Name).ToListAsync();
        return Ok(floors.Select(ToResponse).ToList());
    }

    [HttpPost("floors", Name = "CreatePosFloor")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    [ProducesResponseType(typeof(FloorResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<FloorResponse>> CreateFloor(Guid companyId, SaveFloorRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name)) return BadRequest(_localizer["PosStoreFieldsRequired"].Value);
        if (!await _db.PosStores.AnyAsync(s => s.Id == request.StoreId && s.CompanyId == companyId)) return BadRequest(_localizer["PosStoreNotFound"].Value);
        var floor = new Floor { Id = Guid.NewGuid(), CompanyId = companyId, StoreId = request.StoreId, Name = request.Name.Trim(), SortOrder = request.SortOrder, IsActive = request.IsActive };
        _db.PosFloors.Add(floor);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, ToResponse(floor));
    }

    [HttpPut("floors/{floorId:guid}", Name = "UpdatePosFloor")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    public async Task<ActionResult<FloorResponse>> UpdateFloor(Guid companyId, Guid floorId, SaveFloorRequest request)
    {
        var floor = await _db.PosFloors.Include(f => f.Tables).FirstOrDefaultAsync(f => f.Id == floorId && f.CompanyId == companyId);
        if (floor is null) return NotFound();
        if (string.IsNullOrWhiteSpace(request.Name)) return BadRequest(_localizer["PosStoreFieldsRequired"].Value);
        (floor.Name, floor.SortOrder, floor.IsActive) = (request.Name.Trim(), request.SortOrder, request.IsActive);
        await _db.SaveChangesAsync();
        return Ok(ToResponse(floor));
    }

    [HttpPost("tables", Name = "CreatePosTable")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    [ProducesResponseType(typeof(TableResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<TableResponse>> CreateTable(Guid companyId, SaveTableRequest request)
    {
        if (await ValidateTableAsync(companyId, request) is { } error) return BadRequest(error);
        var table = new DiningTable { Id = Guid.NewGuid(), QrToken = NewToken() };
        Apply(table, request);
        _db.PosTables.Add(table);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, ToResponse(table));
    }

    [HttpPut("tables/{tableId:guid}", Name = "UpdatePosTable")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    public async Task<ActionResult<TableResponse>> UpdateTable(Guid companyId, Guid tableId, SaveTableRequest request)
    {
        var table = await _db.PosTables.FirstOrDefaultAsync(t => t.Id == tableId && _db.PosFloors.Any(f => f.Id == t.FloorId && f.CompanyId == companyId));
        if (table is null) return NotFound();
        if (await ValidateTableAsync(companyId, request) is { } error) return BadRequest(error);
        Apply(table, request);
        await _db.SaveChangesAsync();
        return Ok(ToResponse(table));
    }

    // A new QR code for a table (the old printed one stops working).
    [HttpPost("tables/{tableId:guid}/qr", Name = "RenewPosTableQr")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    public async Task<ActionResult<TableResponse>> RenewQr(Guid companyId, Guid tableId)
    {
        var table = await _db.PosTables.FirstOrDefaultAsync(t => t.Id == tableId && _db.PosFloors.Any(f => f.Id == t.FloorId && f.CompanyId == companyId));
        if (table is null) return NotFound();
        table.QrToken = NewToken();
        await _db.SaveChangesAsync();
        return Ok(ToResponse(table));
    }

    private async Task<string?> ValidateTableAsync(Guid companyId, SaveTableRequest r)
    {
        if (string.IsNullOrWhiteSpace(r.Name) || r.Seats is < 0 or > 100 || r.Width is < 1 or > 20 || r.Height is < 1 or > 20 || r.X < 0 || r.Y < 0)
        {
            return _localizer["PosTableInvalid"].Value;
        }
        return await _db.PosFloors.AnyAsync(f => f.Id == r.FloorId && f.CompanyId == companyId) ? null : _localizer["PosTableNotFound"].Value;
    }

    private static void Apply(DiningTable t, SaveTableRequest r) =>
        (t.FloorId, t.Name, t.Seats, t.Shape, t.X, t.Y, t.Width, t.Height, t.IsActive) =
        (r.FloorId, r.Name.Trim(), r.Seats, r.Shape, r.X, r.Y, r.Width, r.Height, r.IsActive);

    private static string NewToken() => Convert.ToHexString(RandomNumberGenerator.GetBytes(12)).ToLowerInvariant();

    private static FloorResponse ToResponse(Floor f) => new(f.Id, f.StoreId, f.Name, f.SortOrder, f.IsActive,
        f.Tables.OrderBy(t => t.Name).Select(ToResponse).ToList());

    private static TableResponse ToResponse(DiningTable t) => new(t.Id, t.FloorId, t.Name, t.Seats, t.Shape, t.X, t.Y, t.Width, t.Height, t.IsActive, t.QrToken);

    // ---- The live floor ----

    [HttpGet("stores/{storeId:guid}/floor-plan", Name = "GetPosFloorPlan")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<FloorPlanResponse>> FloorPlan(Guid companyId, Guid storeId)
    {
        if (!await _db.PosStores.AnyAsync(s => s.Id == storeId && s.CompanyId == companyId)) return NotFound();
        var floors = await _db.PosFloors.AsNoTracking().Include(f => f.Tables).Where(f => f.StoreId == storeId && f.IsActive)
            .OrderBy(f => f.SortOrder).ThenBy(f => f.Name).ToListAsync();
        var open = await _db.PosTabs.AsNoTracking().Include(t => t.Lines)
            .Where(t => t.StoreId == storeId && (t.State == TabState.Open || t.State == TabState.PreBilled)).OrderBy(t => t.OpenedAt).ToListAsync();
        var tableNames = floors.SelectMany(f => f.Tables).ToDictionary(t => t.Id, t => t.Name);
        var summaries = new List<TabSummaryResponse>();
        foreach (var tab in open) summaries.Add(await _tabs.SummaryAsync(tab, tab.TableId is { } id ? tableNames.GetValueOrDefault(id) : null));
        return Ok(new FloorPlanResponse(
            floors.Select(f => new FloorPlanFloorResponse(f.Id, f.Name, f.Tables.Where(t => t.IsActive).OrderBy(t => t.Name)
                .Select(t => new FloorPlanTableResponse(t.Id, t.Name, t.Seats, t.Shape, t.X, t.Y, t.Width, t.Height,
                    summaries.Where(s => s.TableId == t.Id).ToList())).ToList())).ToList(),
            summaries.Where(s => s.TableId is null || !tableNames.ContainsKey(s.TableId.Value)).ToList()));
    }

    // ---- Tabs ----

    [HttpPost("tabs", Name = "OpenPosTab")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    [ProducesResponseType(typeof(TabResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<TabResponse>> Open(Guid companyId, OpenTabRequest request)
    {
        var store = await _db.PosStores.AsNoTracking().FirstOrDefaultAsync(s => s.Id == request.StoreId && s.CompanyId == companyId);
        if (store is null) return BadRequest(_localizer["PosStoreNotFound"].Value);
        return await RunAsync(store.Id, async () =>
        {
            // P3: the tab is the signed-in waiter's (PIN) on a shared till.
            var waiterId = await _operators.OperatorAsync(Request, companyId) ?? CurrentUserId;
            var waiterName = waiterId == CurrentUserId ? await OperatorNameAsync(companyId) : await _operators.NameAsync(companyId, waiterId);
            var tab = await _tabs.OpenAsync(companyId, store, request, waiterId, waiterName);
            await _db.SaveChangesAsync();
            return StatusCode(StatusCodes.Status201Created, await _tabs.ToResponseAsync(tab));
        });
    }

    [HttpGet("stores/{storeId:guid}/tabs", Name = "ListOpenPosTabs")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<List<TabSummaryResponse>>> OpenTabs(Guid companyId, Guid storeId)
    {
        var tabs = await _db.PosTabs.AsNoTracking().Include(t => t.Lines)
            .Where(t => t.CompanyId == companyId && t.StoreId == storeId && (t.State == TabState.Open || t.State == TabState.PreBilled))
            .OrderBy(t => t.OpenedAt).ToListAsync();
        var tableIds = tabs.Where(t => t.TableId != null).Select(t => t.TableId!.Value).ToList();
        var names = await _db.PosTables.AsNoTracking().Where(t => tableIds.Contains(t.Id)).ToDictionaryAsync(t => t.Id, t => t.Name);
        var result = new List<TabSummaryResponse>();
        foreach (var tab in tabs) result.Add(await _tabs.SummaryAsync(tab, tab.TableId is { } id ? names.GetValueOrDefault(id) : null));
        return Ok(result);
    }

    [HttpGet("tabs/{tabId:guid}", Name = "GetPosTab")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<TabResponse>> Get(Guid companyId, Guid tabId)
    {
        var tab = await _db.PosTabs.AsNoTracking().Include(t => t.Lines).FirstOrDefaultAsync(t => t.Id == tabId && t.CompanyId == companyId);
        return tab is null ? NotFound() : Ok(await _tabs.ToResponseAsync(tab));
    }

    [HttpPut("tabs/{tabId:guid}", Name = "UpdatePosTab")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public Task<ActionResult<TabResponse>> Update(Guid companyId, Guid tabId, UpdateTabRequest request) =>
        WithTabAsync(companyId, tabId, tab =>
        {
            if (!TabService.IsOpen(tab)) throw new PosException(_localizer["PosTabClosed"].Value);
            if (request.Covers is < 0 or > 500) throw new PosException(_localizer["PosAmountInvalid"].Value);
            (tab.Covers, tab.Name, tab.DeliveryAddress, tab.DeliveryPhone, tab.DriverName) =
                (request.Covers, Blank(request.Name), Blank(request.DeliveryAddress), Blank(request.DeliveryPhone), Blank(request.DriverName));
            return Task.CompletedTask;
        });

    [HttpPost("tabs/{tabId:guid}/lines", Name = "AddPosTabLines")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public Task<ActionResult<TabResponse>> AddLines(Guid companyId, Guid tabId, AddTabLinesRequest request) =>
        WithTabAsync(companyId, tabId, async tab =>
        {
            var store = await _db.PosStores.AsNoTracking().FirstAsync(s => s.Id == tab.StoreId);
            await _tabs.AddLinesAsync(companyId, tab, store, request.Lines);
        });

    [HttpPut("tabs/{tabId:guid}/lines/{lineId:guid}", Name = "UpdatePosTabLine")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public Task<ActionResult<TabResponse>> UpdateLine(Guid companyId, Guid tabId, Guid lineId, UpdateTabLineRequest request) =>
        WithTabAsync(companyId, tabId, tab =>
        {
            var line = tab.Lines.FirstOrDefault(l => l.Id == lineId) ?? throw new PosException(_localizer["PosTabLineNotFound"].Value);
            _tabs.UpdateLine(tab, line, request);
            return Task.CompletedTask;
        });

    // Voiding a line the kitchen already has needs a manager (Pos: Approve) and prints a STORNO.
    [HttpPost("tabs/{tabId:guid}/lines/{lineId:guid}/void", Name = "VoidPosTabLine")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public Task<ActionResult<TabResponse>> VoidLine(Guid companyId, Guid tabId, Guid lineId, VoidTabLineRequest request) =>
        WithTabAsync(companyId, tabId, async tab =>
        {
            var line = tab.Lines.FirstOrDefault(l => l.Id == lineId) ?? throw new PosException(_localizer["PosTabLineNotFound"].Value);
            if (line.State == TabLineState.Sent && _access.LevelFor(AccessModule.Pos) < AccessLevel.Approve)
            {
                throw new PosException(_localizer["PosVoidNeedsManager"].Value);
            }
            if ((await _tabs.VoidLineAsync(tab, line, request.Reason, await OperatorIdAsync(companyId))).Count > 0) _ticketsChanged = true;
        });

    [HttpPost("tabs/{tabId:guid}/send", Name = "SendPosTab")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public Task<ActionResult<TabResponse>> Send(Guid companyId, Guid tabId, [FromQuery] int? course = null) =>
        WithTabAsync(companyId, tabId, async tab =>
        {
            if ((await _tabs.SendAsync(tab, course)).Count > 0) _ticketsChanged = true;
        });

    [HttpPost("tabs/{tabId:guid}/transfer", Name = "TransferPosTab")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public Task<ActionResult<TabResponse>> Transfer(Guid companyId, Guid tabId, TransferTabRequest request) =>
        WithTabAsync(companyId, tabId, tab => _tabs.TransferAsync(tab, request.TableId));

    // Brings another tab's unpaid lines onto this one (two tables pushed together).
    [HttpPost("tabs/{tabId:guid}/merge", Name = "MergePosTab")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public Task<ActionResult<TabResponse>> Merge(Guid companyId, Guid tabId, MergeTabRequest request) =>
        WithTabAsync(companyId, tabId, async tab =>
        {
            var from = await LockedTabAsync(companyId, request.FromTabId) ?? throw new PosException(_localizer["PosTabClosed"].Value);
            _tabs.MoveLines(from, tab, from.Lines.Where(l => l.ParentLineId == null && l.State != TabLineState.Voided && l.PaidQuantity == 0).Select(l => l.Id).ToList());
        });

    [HttpPost("tabs/{tabId:guid}/move-lines", Name = "MovePosTabLines")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public Task<ActionResult<TabResponse>> MoveLines(Guid companyId, Guid tabId, MoveTabLinesRequest request) =>
        WithTabAsync(companyId, tabId, async tab =>
        {
            var to = await LockedTabAsync(companyId, request.ToTabId) ?? throw new PosException(_localizer["PosTabClosed"].Value);
            _tabs.MoveLines(tab, to, request.LineIds);
        });

    // The non-fiscal bill shown to the table before paying (counted, so reprints are visible).
    [HttpPost("tabs/{tabId:guid}/prebill", Name = "PreBillPosTab")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public Task<ActionResult<TabResponse>> PreBill(Guid companyId, Guid tabId) =>
        WithTabAsync(companyId, tabId, tab =>
        {
            if (!TabService.IsOpen(tab)) throw new PosException(_localizer["PosTabClosed"].Value);
            tab.PreBillCount++;
            tab.State = TabState.PreBilled;
            return Task.CompletedTask;
        });

    [HttpGet("tabs/{tabId:guid}/split", Name = "SplitPosTab")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<TabSplitResponse>> Split(Guid companyId, Guid tabId, [FromQuery] int ways)
    {
        var tab = await _db.PosTabs.AsNoTracking().Include(t => t.Lines).FirstOrDefaultAsync(t => t.Id == tabId && t.CompanyId == companyId);
        if (tab is null) return NotFound();
        try
        {
            return Ok(await _tabs.SplitAsync(tab, ways));
        }
        catch (PosException ex)
        {
            return BadRequest(ex.Message);
        }
    }

    [HttpPost("tabs/{tabId:guid}/cancel", Name = "CancelPosTab")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public Task<ActionResult<TabResponse>> Cancel(Guid companyId, Guid tabId) =>
        WithTabAsync(companyId, tabId, tab =>
        {
            _tabs.Cancel(tab, CurrentUserId);
            return Task.CompletedTask;
        });

    // QR self-orders wait for a waiter to accept (or refuse) them.
    [HttpPost("tabs/{tabId:guid}/requested", Name = "AnswerPosTabRequests")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public Task<ActionResult<TabResponse>> Requested(Guid companyId, Guid tabId, [FromQuery] bool accept = true) =>
        WithTabAsync(companyId, tabId, tab =>
        {
            return AnswerAsync(companyId, tab, accept);
        });

    // ---- Kitchen display ----

    [HttpGet("stores/{storeId:guid}/kitchen-tickets", Name = "ListKitchenTickets")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<List<KitchenTicketResponse>>> Tickets(Guid companyId, Guid storeId, [FromQuery] Guid? centerId = null,
        [FromQuery] bool recentDone = false)
    {
        var since = DateTime.UtcNow.AddHours(-1);
        var query = _db.PosKitchenTickets.AsNoTracking().Include(t => t.Lines)
            .Where(t => t.CompanyId == companyId && t.StoreId == storeId && (t.State != KitchenTicketState.Done || (recentDone && t.DoneAt >= since)));
        if (centerId is { } c) query = query.Where(t => t.ProductionCenterId == c);
        var tickets = await query.OrderBy(t => t.CreatedAt).Take(300).ToListAsync();
        var centers = await _db.PosProductionCenters.AsNoTracking().Where(p => p.CompanyId == companyId).ToDictionaryAsync(p => p.Id, p => p.Name);
        return Ok(tickets.Select(t => new KitchenTicketResponse(t.Id, t.TabId, t.ProductionCenterId,
            t.ProductionCenterId is { } pc ? centers.GetValueOrDefault(pc) : null, t.Number, t.IsStorno, t.State, t.TabLabel, t.WaiterName, t.CreatedAt,
            t.StartedAt, t.ReadyAt, t.DoneAt,
            t.Lines.OrderBy(l => l.Course).Select(l => new KitchenTicketLineResponse(l.TabLineId, l.Description, l.Quantity, l.Modifiers, l.Note, l.Seat, l.Course)).ToList()))
            .ToList());
    }

    [HttpPost("kitchen-tickets/{ticketId:guid}/state", Name = "SetKitchenTicketState")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public async Task<IActionResult> TicketState(Guid companyId, Guid ticketId, KitchenTicketStateRequest request)
    {
        var ticket = await _db.PosKitchenTickets.FirstOrDefaultAsync(t => t.Id == ticketId && t.CompanyId == companyId);
        if (ticket is null) return NotFound();
        var now = DateTime.UtcNow;
        ticket.State = request.State;
        switch (request.State)
        {
            case KitchenTicketState.InProgress: ticket.StartedAt ??= now; break;
            case KitchenTicketState.Ready: ticket.ReadyAt ??= now; break;
            case KitchenTicketState.Done: ticket.DoneAt ??= now; break;
        }
        await _db.SaveChangesAsync();
        await _notify.TicketsChangedAsync(ticket.StoreId);
        return NoContent();
    }

    // ---- Helpers ----

    private async Task AnswerAsync(Guid companyId, Tab tab, bool accept) => _tabs.AcceptRequested(tab, await OperatorIdAsync(companyId), accept);

    // The PIN-signed-in waiter on a shared till, else the signed-in member.
    private async Task<Guid> OperatorIdAsync(Guid companyId) => await _operators.OperatorAsync(Request, companyId) ?? CurrentUserId;

    private bool _ticketsChanged;

    private async Task<Tab?> LockedTabAsync(Guid companyId, Guid tabId)
    {
        if (_db.Database.SupportsRowLocking() && _db.Database.CurrentTransaction is not null)
        {
            await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT \"Id\" FROM pos_tabs WHERE \"Id\" = {tabId} FOR UPDATE");
        }
        return await _db.PosTabs.Include(t => t.Lines).FirstOrDefaultAsync(t => t.Id == tabId && t.CompanyId == companyId);
    }

    // Runs a change on a tab under its row lock, saves, tells the store's screens, answers the tab.
    private async Task<ActionResult<TabResponse>> WithTabAsync(Guid companyId, Guid tabId, Func<Tab, Task> change)
    {
        await using var transaction = _db.Database.SupportsRowLocking() ? await _db.Database.BeginTransactionAsync() : null;
        var tab = await LockedTabAsync(companyId, tabId);
        if (tab is null) return NotFound();
        return await RunAsync(tab.StoreId, async () =>
        {
            await change(tab);
            await _db.SaveChangesAsync();
            if (transaction is not null) await transaction.CommitAsync();
            return Ok(await _tabs.ToResponseAsync(tab));
        });
    }

    private async Task<ActionResult<TabResponse>> RunAsync(Guid storeId, Func<Task<ActionResult<TabResponse>>> work)
    {
        try
        {
            var result = await work();
            await _notify.TabsChangedAsync(storeId);
            if (_ticketsChanged) await _notify.TicketsChangedAsync(storeId);
            return result;
        }
        catch (PosException ex)
        {
            _db.ChangeTracker.Clear();
            return BadRequest(ex.Message);
        }
    }

    private async Task<string> OperatorNameAsync(Guid companyId)
    {
        var userId = CurrentUserId;
        var name = await _db.Employees.AsNoTracking().Where(e => e.CompanyId == companyId && e.UserId == userId).Select(e => e.Name).FirstOrDefaultAsync();
        if (!string.IsNullOrWhiteSpace(name)) return name;
        var email = User.FindFirstValue(JwtRegisteredClaimNames.Email) ?? User.FindFirstValue(ClaimTypes.Email);
        return string.IsNullOrWhiteSpace(email) ? userId.ToString()[..8] : email.Split('@')[0];
    }

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
