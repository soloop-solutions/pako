using System.Collections.Concurrent;
using System.Security.Cryptography;

namespace Pako.Api.Services;

public class PosApprovalTokens
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromSeconds(60);
    private const int MaxFailures = 5;
    private static readonly TimeSpan Lockout = TimeSpan.FromMinutes(15);

    private readonly ConcurrentDictionary<string, Approval> _tokens = new();
    private readonly ConcurrentDictionary<Guid, Failures> _failures = new();
    private readonly TimeProvider _clock;
    private long _issued;

    public PosApprovalTokens(TimeProvider? clock = null)
    {
        _clock = clock ?? TimeProvider.System;
    }

    private DateTime Now => _clock.GetUtcNow().UtcDateTime;

    public (string Token, DateTime ExpiresAtUtc) Issue(Guid companyId, Guid approverUserId)
    {
        if (Interlocked.Increment(ref _issued) % 50 == 0) RemoveExpired();
        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
        var expires = Now.Add(Lifetime);
        _tokens[token] = new Approval(companyId, approverUserId, expires);
        return (token, expires);
    }

    public Guid? TryConsume(string? token, Guid companyId)
    {
        if (string.IsNullOrWhiteSpace(token) || !_tokens.TryRemove(token, out var approval)) return null;
        return approval.ExpiresAtUtc >= Now && approval.CompanyId == companyId ? approval.ApproverUserId : null;
    }

    public bool IsLocked(Guid requesterUserId)
    {
        if (!_failures.TryGetValue(requesterUserId, out var failed)) return false;
        if (Now - failed.LastAtUtc >= Lockout)
        {
            _failures.TryRemove(requesterUserId, out _);
            return false;
        }
        return failed.Count >= MaxFailures;
    }

    public void RecordFailure(Guid requesterUserId)
    {
        var now = Now;
        _failures.AddOrUpdate(requesterUserId,
            _ => new Failures(1, now),
            (_, failed) => now - failed.LastAtUtc >= Lockout ? new Failures(1, now) : new Failures(failed.Count + 1, now));
    }

    public void ResetFailures(Guid requesterUserId) => _failures.TryRemove(requesterUserId, out _);

    private void RemoveExpired()
    {
        var now = Now;
        foreach (var pair in _tokens)
        {
            if (pair.Value.ExpiresAtUtc < now) _tokens.TryRemove(pair.Key, out _);
        }
    }

    private record Approval(Guid CompanyId, Guid ApproverUserId, DateTime ExpiresAtUtc);

    private record Failures(int Count, DateTime LastAtUtc);
}
