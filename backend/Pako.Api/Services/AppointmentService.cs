using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Contracts;
using Pako.Domain.Pos;
using Pako.Infrastructure;

namespace Pako.Api.Services;

// docs/POS_PLAN.md P4: appointments. A booking must fall inside the resource's working hours (in
// Kosovo time) and must not overlap another live booking of the same resource, the service's
// buffer included. Free start times step every 15 minutes.
public class AppointmentService
{
    public const int SlotMinutes = 15;
    private static readonly AppointmentState[] Live = { AppointmentState.Booked, AppointmentState.Confirmed, AppointmentState.CheckedIn, AppointmentState.Completed };

    private readonly PakoDbContext _db;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public AppointmentService(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _localizer = localizer;
    }

    private PosException Fail(string key, params object[] args) =>
        new(args.Length == 0 ? _localizer[key].Value : string.Format(_localizer[key].Value, args));

    public record Service(Guid ItemId, string Name, int Duration, int Buffer);

    public async Task<Service> ServiceAsync(Guid companyId, Guid itemId)
    {
        var item = await _db.Items.AsNoTracking().FirstOrDefaultAsync(i => i.Id == itemId && i.CompanyId == companyId && i.IsBookable && i.DurationMinutes != null)
            ?? throw Fail("PosServiceNotBookable");
        return new Service(item.Id, item.Name, item.DurationMinutes!.Value, item.BufferMinutes ?? 0);
    }

    // Books (or moves) an appointment after checking hours and overlaps.
    public async Task CheckSlotAsync(Guid companyId, Guid storeId, Service service, Guid resourceId, DateTime start, Guid? exceptId, bool online)
    {
        start = DateTime.SpecifyKind(start, DateTimeKind.Utc);
        var resource = await _db.PosResources.AsNoTracking().Include(r => r.Hours)
            .FirstOrDefaultAsync(r => r.Id == resourceId && r.CompanyId == companyId && r.StoreId == storeId && r.IsActive) ?? throw Fail("PosResourceNotFound");
        if (!await _db.PosServiceResources.AnyAsync(l => l.ItemId == service.ItemId && l.ResourceId == resourceId)) throw Fail("PosResourceCantServe", resource.Name, service.Name);
        if (online && start < DateTime.UtcNow.AddMinutes(30)) throw Fail("PosSlotTaken");
        if (!WithinHours(resource, start, service.Duration)) throw Fail("PosOutsideHours", resource.Name);
        var end = start.AddMinutes(service.Duration);
        if (await OverlapsAsync(resourceId, start, end, service.Buffer, exceptId)) throw Fail("PosSlotTaken");
    }

    private async Task<bool> OverlapsAsync(Guid resourceId, DateTime start, DateTime end, int buffer, Guid? exceptId)
    {
        var from = start.AddMinutes(-buffer);
        var to = end.AddMinutes(buffer);
        return await _db.PosAppointments.AnyAsync(a => a.ResourceId == resourceId && a.Id != exceptId && Live.Contains(a.State) && a.Start < to && a.End > from);
    }

    private static bool WithinHours(ServiceResource resource, DateTime startUtc, int minutes)
    {
        var local = PosService.LocalTime(startUtc);
        var end = local.AddMinutes(minutes);
        if (end.Date != local.Date) return false;
        var day = ((int)local.DayOfWeek + 6) % 7;
        var from = TimeOnly.FromDateTime(local);
        var to = TimeOnly.FromDateTime(end);
        return resource.Hours.Any(h => h.Day == day && h.From <= from && to <= h.To);
    }

    // Free start times on a local day for a service, per resource that can perform it.
    public async Task<AvailabilityResponse> AvailabilityAsync(Guid companyId, Guid storeId, Guid itemId, DateOnly date, Guid? resourceId)
    {
        var service = await ServiceAsync(companyId, itemId);
        var resourceIds = await _db.PosServiceResources.AsNoTracking().Where(l => l.ItemId == itemId).Select(l => l.ResourceId).ToListAsync();
        var resources = await _db.PosResources.AsNoTracking().Include(r => r.Hours)
            .Where(r => r.CompanyId == companyId && r.StoreId == storeId && r.IsActive && resourceIds.Contains(r.Id) && (resourceId == null || r.Id == resourceId))
            .OrderBy(r => r.Name).ToListAsync();
        var dayStart = PosService.UtcFromLocal(date.ToDateTime(TimeOnly.MinValue));
        var dayEnd = PosService.UtcFromLocal(date.AddDays(1).ToDateTime(TimeOnly.MinValue));
        var ids = resources.Select(r => r.Id).ToList();
        var booked = await _db.PosAppointments.AsNoTracking()
            .Where(a => ids.Contains(a.ResourceId) && Live.Contains(a.State) && a.Start < dayEnd.AddHours(2) && a.End > dayStart.AddHours(-2)).ToListAsync();
        var earliest = DateTime.UtcNow.AddMinutes(30);
        var result = new List<AvailabilityResourceResponse>();
        foreach (var r in resources)
        {
            var starts = new List<DateTime>();
            var day = ((int)date.DayOfWeek + 6) % 7;
            foreach (var span in r.Hours.Where(h => h.Day == day).OrderBy(h => h.From))
            {
                for (var t = span.From; t.AddMinutes(service.Duration) <= span.To && t.AddMinutes(service.Duration) > t; t = t.AddMinutes(SlotMinutes))
                {
                    var start = PosService.UtcFromLocal(date.ToDateTime(t));
                    var end = start.AddMinutes(service.Duration);
                    if (start < earliest) continue;
                    if (booked.Any(a => a.ResourceId == r.Id && a.Start < end.AddMinutes(service.Buffer) && a.End > start.AddMinutes(-service.Buffer))) continue;
                    starts.Add(start);
                }
            }
            result.Add(new AvailabilityResourceResponse(r.Id, r.Name, starts));
        }
        return new AvailabilityResponse(date, service.Duration, result);
    }

    public async Task<string> NextNumberAsync(Guid companyId) =>
        $"AP-{await _db.PosAppointments.CountAsync(a => a.CompanyId == companyId) + 1:D5}";

    public static string NewToken() => Convert.ToHexString(RandomNumberGenerator.GetBytes(10)).ToLowerInvariant();

    public async Task<List<AppointmentResponse>> ToResponsesAsync(IReadOnlyList<Appointment> appointments)
    {
        var itemIds = appointments.Select(a => a.ItemId).Distinct().ToList();
        var items = await _db.Items.AsNoTracking().Where(i => itemIds.Contains(i.Id)).ToDictionaryAsync(i => i.Id);
        var resourceIds = appointments.Select(a => a.ResourceId).Distinct().ToList();
        var resources = await _db.PosResources.AsNoTracking().Where(r => resourceIds.Contains(r.Id)).ToDictionaryAsync(r => r.Id, r => r.Name);
        var cardIds = appointments.Where(a => a.DepositCardId != null).Select(a => a.DepositCardId!.Value).ToList();
        var cards = await _db.GiftCards.AsNoTracking().Where(c => cardIds.Contains(c.Id)).ToDictionaryAsync(c => c.Id);
        return appointments.Select(a =>
        {
            var card = a.DepositCardId is { } id ? cards.GetValueOrDefault(id) : null;
            return new AppointmentResponse(a.Id, a.Number, a.StoreId, a.ItemId, items.GetValueOrDefault(a.ItemId)?.Name ?? "?", a.ResourceId,
                resources.GetValueOrDefault(a.ResourceId) ?? "?", a.Start, a.End, a.State, a.Source, a.CustomerId, a.CustomerName, a.Phone, a.Email, a.Notes,
                card?.Number, card?.Balance ?? 0m, items.GetValueOrDefault(a.ItemId)?.DefaultUnitPrice, a.PosOrderId);
        }).ToList();
    }
}
