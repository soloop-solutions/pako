namespace Pako.Api.Contracts;

public record FavoriteResponse(
    Guid Id,
    Guid EntityId,
    string EntityType,
    bool IsPinned,
    bool IsSuppressed,
    int SelectionCount,
    DateTime? LastSelectedAtUtc
);

public record FavoritesListResponse(List<FavoriteResponse> Items);

public record PinFavoriteRequest(bool IsPinned);

public record SuppressFavoriteRequest(bool IsSuppressed);

public record RecordSelectionRequest(Guid EntityId, string EntityType);

public record RecordSelectionsRequest(List<RecordSelectionRequest> Selections);
