namespace Pako.Api.Contracts;

public record NotificationSettingResponse(string Template, bool Enabled);

public record SaveNotificationSettingsRequest(List<NotificationSettingResponse> Settings);

// One outbox row, for the delivery log in Settings. The body is not returned — it may hold
// personal data and is rebuilt from the template when sent.
public record NotificationLogResponse(
    Guid Id,
    string Template,
    string RecipientEmail,
    string State,
    int Attempts,
    string? LastError,
    DateTime CreatedAt,
    DateTime? SentAt);
