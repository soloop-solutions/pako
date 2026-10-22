using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Domain.Shared;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId:guid}/favorites")]
[Authorize]
public class FavoritesController : ControllerBase
{
    private readonly PakoDbContext _db;

    private static readonly HashSet<string> ValidEntityTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "Account", "Partner", "Item", "Project", "Employee"
    };

    public FavoritesController(PakoDbContext db) => _db = db;

    private Guid GetUserId() =>
        Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    private static FavoriteResponse ToResponse(UserFavorite f) => new(
        f.Id, f.EntityId, f.EntityType, f.IsPinned, f.IsSuppressed,
        f.SelectionCount, f.LastSelectedAtUtc);

    /// <summary>
    /// Returns all favorites for the current user in a company, optionally filtered by entity type.
    /// </summary>
    [HttpGet]
    [RequireCompanyAccess]
    public async Task<ActionResult<FavoritesListResponse>> List(
        Guid companyId,
        [FromQuery] string? entityType)
    {
        var userId = GetUserId();
        var query = _db.UserFavorites.AsNoTracking()
            .Where(f => f.UserId == userId && f.CompanyId == companyId);

        if (!string.IsNullOrWhiteSpace(entityType))
        {
            query = query.Where(f => f.EntityType == entityType);
        }

        var favorites = await query
            .OrderByDescending(f => f.IsPinned)
            .ThenByDescending(f => f.SelectionCount)
            .ThenByDescending(f => f.LastSelectedAtUtc)
            .ToListAsync();

        return Ok(new FavoritesListResponse(favorites.Select(ToResponse).ToList()));
    }

    /// <summary>
    /// Pin or unpin a favorite. Creates the record if it doesn't exist.
    /// </summary>
    [HttpPut("{entityType}/{entityId:guid}/pin")]
    [RequireCompanyAccess]
    public async Task<ActionResult<FavoriteResponse>> Pin(
        Guid companyId, string entityType, Guid entityId,
        [FromBody] PinFavoriteRequest request)
    {
        if (!ValidEntityTypes.Contains(entityType))
            return BadRequest($"Invalid entity type: {entityType}");

        var userId = GetUserId();
        var favorite = await _db.UserFavorites
            .FirstOrDefaultAsync(f =>
                f.UserId == userId && f.CompanyId == companyId &&
                f.EntityType == entityType && f.EntityId == entityId);

        if (favorite == null)
        {
            favorite = new UserFavorite
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                CompanyId = companyId,
                EntityType = entityType,
                EntityId = entityId,
                IsPinned = request.IsPinned,
            };
            _db.UserFavorites.Add(favorite);
        }
        else
        {
            favorite.IsPinned = request.IsPinned;
            // If pinning, clear suppression
            if (request.IsPinned)
                favorite.IsSuppressed = false;
        }

        await _db.SaveChangesAsync();
        return Ok(ToResponse(favorite));
    }

    /// <summary>
    /// Suppress or unsuppress an automatic favorite suggestion.
    /// </summary>
    [HttpPut("{entityType}/{entityId:guid}/suppress")]
    [RequireCompanyAccess]
    public async Task<ActionResult<FavoriteResponse>> Suppress(
        Guid companyId, string entityType, Guid entityId,
        [FromBody] SuppressFavoriteRequest request)
    {
        if (!ValidEntityTypes.Contains(entityType))
            return BadRequest($"Invalid entity type: {entityType}");

        var userId = GetUserId();
        var favorite = await _db.UserFavorites
            .FirstOrDefaultAsync(f =>
                f.UserId == userId && f.CompanyId == companyId &&
                f.EntityType == entityType && f.EntityId == entityId);

        if (favorite == null)
        {
            favorite = new UserFavorite
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                CompanyId = companyId,
                EntityType = entityType,
                EntityId = entityId,
                IsSuppressed = request.IsSuppressed,
            };
            _db.UserFavorites.Add(favorite);
        }
        else
        {
            favorite.IsSuppressed = request.IsSuppressed;
        }

        await _db.SaveChangesAsync();
        return Ok(ToResponse(favorite));
    }

    /// <summary>
    /// Record one or more entity selections (batch). Increments selection count
    /// and updates last-selected timestamp. Deduplicates within the batch.
    /// </summary>
    [HttpPost("selections")]
    [RequireCompanyAccess(writeAccess: true)]
    public async Task<IActionResult> RecordSelections(
        Guid companyId,
        [FromBody] RecordSelectionsRequest request)
    {
        if (request.Selections.Count == 0)
            return Ok();

        var userId = GetUserId();
        var now = DateTime.UtcNow;

        // Deduplicate within the batch
        var unique = request.Selections
            .Where(s => ValidEntityTypes.Contains(s.EntityType))
            .GroupBy(s => (s.EntityType, s.EntityId))
            .Select(g => (g.Key.EntityType, g.Key.EntityId, Count: g.Count()))
            .ToList();

        // Load existing records in one query
        var keys = unique.Select(u => u.EntityId).ToList();
        var existing = await _db.UserFavorites
            .Where(f => f.UserId == userId && f.CompanyId == companyId && keys.Contains(f.EntityId))
            .ToListAsync();

        var lookup = existing.ToDictionary(f => (f.EntityType, f.EntityId));

        foreach (var (entityType, entityId, count) in unique)
        {
            if (lookup.TryGetValue((entityType, entityId), out var fav))
            {
                fav.SelectionCount += count;
                fav.LastSelectedAtUtc = now;
            }
            else
            {
                _db.UserFavorites.Add(new UserFavorite
                {
                    Id = Guid.NewGuid(),
                    UserId = userId,
                    CompanyId = companyId,
                    EntityType = entityType,
                    EntityId = entityId,
                    SelectionCount = count,
                    LastSelectedAtUtc = now,
                });
            }
        }

        await _db.SaveChangesAsync();
        return Ok();
    }
}
