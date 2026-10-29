namespace Pako.Domain.Shared;

/// <summary>
/// Tracks user-specific entity favorites and selection frequency.
/// Supports manual pinning, automatic frequency-based suggestions,
/// and suppression of dismissed automatic suggestions.
/// Scoped by user + company + entity type.
/// </summary>
public class UserFavorite
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public Guid CompanyId { get; set; }

    /// <summary>Account, Partner, Item, Project, Employee</summary>
    public string EntityType { get; set; } = string.Empty;

    public Guid EntityId { get; set; }

    /// <summary>True when the user explicitly pinned this entity.</summary>
    public bool IsPinned { get; set; }

    /// <summary>True when the user dismissed the automatic suggestion. Prevents re-adding.</summary>
    public bool IsSuppressed { get; set; }

    /// <summary>Number of times the user selected this entity (meaningful selections only).</summary>
    public int SelectionCount { get; set; }

    public DateTime? LastSelectedAtUtc { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
}
