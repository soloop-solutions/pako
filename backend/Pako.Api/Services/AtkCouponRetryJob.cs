using Microsoft.EntityFrameworkCore;
using Pako.Domain.Pos;
using Pako.Infrastructure;

namespace Pako.Api.Services;

// AI 01/2026 Art. 44: offline coupons must reach ATK within 48 hours. This job runs every minute
// (from BackgroundJobsHostedService) and sends up to 20 pending fiscal documents per tick.
public static class AtkCouponRetryJob
{
    private const int BatchSize = 20;

    public static async Task RunAsync(IServiceProvider services, CancellationToken cancellationToken)
    {
        var db = services.GetRequiredService<PakoDbContext>();
        var pos = services.GetRequiredService<PosService>();
        var logger = services.GetRequiredService<ILogger<PosService>>();

        var pending = await db.FiscalDocuments
            .Where(d => d.AtkStatus == AtkStatus.Pending)
            .OrderBy(d => d.IssuedAt)
            .Take(BatchSize)
            .ToListAsync(cancellationToken);

        if (pending.Count == 0) return;

        foreach (var doc in pending)
        {
            try
            {
                await pos.TrySendToAtkAsync(doc);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "ATK retry failed for coupon {CouponId}", doc.CouponId);
            }
        }

        await db.SaveChangesAsync(cancellationToken);

        var overdue = pending.Count(d => d.AtkStatus == AtkStatus.Pending && d.SendBy.HasValue && d.SendBy.Value <= DateTime.UtcNow);
        if (overdue > 0)
        {
            logger.LogWarning("ATK: {Count} coupons have passed the 48-hour offline deadline", overdue);
        }
    }
}
