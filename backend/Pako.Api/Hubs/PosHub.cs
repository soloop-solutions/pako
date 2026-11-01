using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Pako.Infrastructure;

namespace Pako.Api.Hubs;

// docs/POS_PLAN.md P3: live updates for kitchen screens (KDS) and floor plans. A screen joins its
// store's channel and hears "tickets" and "tabs" when something changes; it then reads the new
// state through the ordinary (access-checked) endpoints, so the hub itself carries no data.
[Authorize]
public class PosHub : Hub
{
    private readonly PakoDbContext _db;

    public PosHub(PakoDbContext db) => _db = db;

    public static string StoreGroup(Guid storeId) => $"store:{storeId}";

    public async Task JoinStore(Guid companyId, Guid storeId)
    {
        var userId = Guid.Parse(Context.User!.FindFirstValue(ClaimTypes.NameIdentifier)!);
        var store = await _db.PosStores.AsNoTracking().FirstOrDefaultAsync(s => s.Id == storeId && s.CompanyId == companyId);
        var company = await _db.Companies.AsNoTracking().FirstOrDefaultAsync(c => c.Id == companyId);
        if (store is null || company is null || !company.EnabledModules.HasFlag(Pako.Domain.Companies.AppModule.Pos)) throw new HubException("Not found.");
        var member = await _db.Memberships.AsNoTracking().AnyAsync(m => m.UserId == userId && m.IsActive
            && (m.CompanyId == companyId || (company.FirmId != null && m.FirmId == company.FirmId)));
        if (!member) throw new HubException("Not found.");
        await Groups.AddToGroupAsync(Context.ConnectionId, StoreGroup(storeId));
    }

    public Task LeaveStore(Guid storeId) => Groups.RemoveFromGroupAsync(Context.ConnectionId, StoreGroup(storeId));
}

// Tells a store's screens that tickets or tabs changed.
public class PosNotifier
{
    private readonly IHubContext<PosHub> _hub;

    public PosNotifier(IHubContext<PosHub> hub) => _hub = hub;

    public Task TicketsChangedAsync(Guid storeId) => _hub.Clients.Group(PosHub.StoreGroup(storeId)).SendAsync("tickets");

    public Task TabsChangedAsync(Guid storeId) => _hub.Clients.Group(PosHub.StoreGroup(storeId)).SendAsync("tabs");
}
