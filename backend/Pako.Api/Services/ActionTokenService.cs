using System.Collections.Concurrent;
using System.Security.Cryptography;

namespace Pako.Api.Services;

public class ActionTokenService
{
    private readonly ConcurrentDictionary<string, ActionTokenEntry> _tokens = new();
    private readonly TimeSpan _tokenLifetime = TimeSpan.FromMinutes(5);
    private readonly int _maxFailedAttempts = 5;
    private readonly TimeSpan _lockoutDuration = TimeSpan.FromMinutes(15);
    private readonly ConcurrentDictionary<string, FailedAttempts> _failedAttempts = new();
    private readonly TimeProvider _clock;
    private long _cleanupCounter;

    public ActionTokenService(TimeProvider? clock = null)
    {
        _clock = clock ?? TimeProvider.System;
    }

    public (string Token, DateTime ExpiresAtUtc) GenerateToken(Guid userId, Guid companyId, string action)
    {
        // Periodic cleanup of expired tokens (every 50 calls)
        if (Interlocked.Increment(ref _cleanupCounter) % 50 == 0)
            CleanupExpired();

        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
        var expiresAt = DateTime.UtcNow.Add(_tokenLifetime);
        _tokens[token] = new ActionTokenEntry(userId, companyId, action, expiresAt);
        return (token, expiresAt);
    }

    public bool ValidateAndConsume(string token, Guid userId, Guid companyId, string action)
    {
        if (!_tokens.TryRemove(token, out var entry))
            return false;

        if (entry.ExpiresAtUtc < DateTime.UtcNow)
            return false;

        return entry.UserId == userId && entry.CompanyId == companyId && entry.Action == action;
    }

    public bool IsRateLimited(Guid userId)
    {
        var key = userId.ToString();
        if (!_failedAttempts.TryGetValue(key, out var failed)) return false;
        if (_clock.GetUtcNow().UtcDateTime - failed.LastAtUtc >= _lockoutDuration)
        {
            _failedAttempts.TryRemove(key, out _);
            return false;
        }
        return failed.Count >= _maxFailedAttempts;
    }

    public void RecordFailedAttempt(Guid userId)
    {
        var now = _clock.GetUtcNow().UtcDateTime;
        _failedAttempts.AddOrUpdate(userId.ToString(),
            _ => new FailedAttempts(1, now),
            (_, failed) => now - failed.LastAtUtc >= _lockoutDuration ? new FailedAttempts(1, now) : new FailedAttempts(failed.Count + 1, now));
    }

    public void ResetFailedAttempts(Guid userId)
    {
        _failedAttempts.TryRemove(userId.ToString(), out _);
    }

    private void CleanupExpired()
    {
        var now = DateTime.UtcNow;
        foreach (var kvp in _tokens)
        {
            if (kvp.Value.ExpiresAtUtc < now)
                _tokens.TryRemove(kvp.Key, out _);
        }
    }

    private record ActionTokenEntry(Guid UserId, Guid CompanyId, string Action, DateTime ExpiresAtUtc);

    private record FailedAttempts(int Count, DateTime LastAtUtc);
}
