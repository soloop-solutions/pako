using System.Collections.Concurrent;

namespace Pako.Api.Desktop;

public sealed class RecoveryThrottle(TimeProvider clock)
{
    public const int MaxFailures = 5;
    public static readonly TimeSpan LockDuration = TimeSpan.FromMinutes(15);

    private sealed record Entry(int Failures, DateTimeOffset? LockedUntil);

    private readonly ConcurrentDictionary<string, Entry> _entries = new();

    public bool IsLocked(string email) =>
        _entries.TryGetValue(Key(email), out var e) && e.LockedUntil is { } until && until > clock.GetUtcNow();

    public void RecordFailure(string email)
    {
        var now = clock.GetUtcNow();
        _entries.AddOrUpdate(Key(email),
            _ => new Entry(1, null),
            (_, e) =>
            {
                var failures = e.LockedUntil is { } until && until <= now ? 1 : e.Failures + 1;
                return failures >= MaxFailures ? new Entry(0, now + LockDuration) : new Entry(failures, null);
            });
    }

    public void Reset(string email) => _entries.TryRemove(Key(email), out _);

    private static string Key(string email) => email.Trim().ToUpperInvariant();
}
