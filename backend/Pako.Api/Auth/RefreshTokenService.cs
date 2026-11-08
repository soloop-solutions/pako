using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Pako.Infrastructure;
using Pako.Infrastructure.Identity;

namespace Pako.Api.Auth;

public class RefreshTokenService
{
    private readonly PakoDbContext _db;
    private readonly JwtOptions _options;

    public RefreshTokenService(PakoDbContext db, JwtOptions options)
    {
        _db = db;
        _options = options;
    }

    public async Task<string> IssueAsync(Guid userId, Guid? familyId = null)
    {
        var raw = Convert.ToBase64String(RandomNumberGenerator.GetBytes(48)).Replace('+', '-').Replace('/', '_').TrimEnd('=');
        var now = DateTime.UtcNow;
        _db.RefreshTokens.Add(new RefreshToken
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            FamilyId = familyId ?? Guid.NewGuid(),
            TokenHash = Hash(raw),
            CreatedAt = now,
            ExpiresAt = now.AddDays(_options.RefreshTokenDays)
        });
        await _db.SaveChangesAsync();
        return raw;
    }

    public async Task<(Guid UserId, string NewToken)?> RotateAsync(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var hash = Hash(raw);
        var token = await _db.RefreshTokens.FirstOrDefaultAsync(t => t.TokenHash == hash);
        if (token is null) return null;

        var now = DateTime.UtcNow;
        if (token.RevokedAt is not null || token.ExpiresAt <= now) return null;

        if (token.UsedAt is { } usedAt)
        {
            if (now - usedAt > TimeSpan.FromSeconds(_options.RefreshReuseGraceSeconds))
            {
                await RevokeFamilyAsync(token.FamilyId);
                return null;
            }
        }
        else
        {
            await _db.RefreshTokens
                .Where(t => t.Id == token.Id && t.UsedAt == null)
                .ExecuteUpdateAsync(u => u.SetProperty(t => t.UsedAt, now));
        }

        return (token.UserId, await IssueAsync(token.UserId, token.FamilyId));
    }

    public async Task RevokeAsync(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return;
        var hash = Hash(raw);
        var token = await _db.RefreshTokens.AsNoTracking().FirstOrDefaultAsync(t => t.TokenHash == hash);
        if (token is not null) await RevokeFamilyAsync(token.FamilyId);
    }

    public Task RevokeAllForUserAsync(Guid userId) => RevokeAsync(t => t.UserId == userId);

    private Task RevokeFamilyAsync(Guid familyId) => RevokeAsync(t => t.FamilyId == familyId);

    private async Task RevokeAsync(System.Linq.Expressions.Expression<Func<RefreshToken, bool>> filter)
    {
        var now = DateTime.UtcNow;
        var tokens = await _db.RefreshTokens.Where(filter).Where(t => t.RevokedAt == null).ToListAsync();
        foreach (var token in tokens) token.RevokedAt = now;
        await _db.SaveChangesAsync();
    }

    private static string Hash(string raw) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(raw))).ToLowerInvariant();
}
