namespace Pako.Domain.Notifications;

public enum NotificationState
{
    Pending,
    Sent,
    Failed,

    // Never sent because the company switched the template off or there was no address.
    Skipped
}

// E7: an outbox row. Business code adds one in the same SaveChanges as the change it reports
// (so a rolled-back change never emails anyone); the background dispatcher (E8) delivers it.
public class Notification
{
    public const int MaxAttempts = 6;

    public Guid Id { get; set; }

    // Null for firm-level mail (the weekly payroll digest).
    public Guid? CompanyId { get; set; }
    public string RecipientEmail { get; set; } = string.Empty;
    public string Template { get; set; } = string.Empty;

    // "en" or "sq" — the recipient's language, resolved when the row is written.
    public string Culture { get; set; } = "sq";

    // Template placeholders, JSON object of string → string.
    public string PayloadJson { get; set; } = "{}";

    // Optional attachment rendered at send time from immutable data (e.g. a posted payslip line).
    public string? AttachmentKind { get; set; }
    public Guid? AttachmentRefId { get; set; }

    public NotificationState State { get; set; } = NotificationState.Pending;
    public int Attempts { get; set; }
    public DateTime NextAttemptAt { get; set; } = DateTime.UtcNow;

    // A dispatcher holds a row while it sends it; another instance skips it until this passes.
    public DateTime? LockedUntil { get; set; }
    public string? LastError { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? SentAt { get; set; }

    public void MarkSent(DateTime now)
    {
        State = NotificationState.Sent;
        SentAt = now;
        LockedUntil = null;
        LastError = null;
    }

    // Exponential backoff: 1, 2, 4, 8, 16 minutes, then Failed for good.
    public void MarkAttemptFailed(string error, DateTime now)
    {
        Attempts++;
        LastError = error.Length > 1000 ? error[..1000] : error;
        LockedUntil = null;
        if (Attempts >= MaxAttempts)
        {
            State = NotificationState.Failed;
            return;
        }

        NextAttemptAt = now.AddMinutes(Math.Pow(2, Attempts - 1));
    }
}

// The catalogue of emails. Keys double as resx prefixes: Email_{Template}_Subject / _Body.
public static class NotificationTemplates
{
    public const string LeaveSubmitted = "LeaveSubmitted";
    public const string LeaveDecided = "LeaveDecided";
    public const string PayslipReady = "PayslipReady";
    public const string StaffInvitation = "StaffInvitation";
    public const string EdiDeadline = "EdiDeadline";
    public const string ContractEnding = "ContractEnding";
    public const string ProbationEnding = "ProbationEnding";
    public const string ProfileChangeRequested = "ProfileChangeRequested";
    public const string ProfileChangeDecided = "ProfileChangeDecided";
    public const string ExpenseClaimSubmitted = "ExpenseClaimSubmitted";
    public const string ExpenseClaimDecided = "ExpenseClaimDecided";
    public const string FirmPayrollDigest = "FirmPayrollDigest";

    // docs/USER_ACCESS_PLAN.md. Security mail: never switchable off per company.
    public const string UserInvitation = "UserInvitation";
    public const string PasswordReset = "PasswordReset";

    // What a company can switch off in Settings. The firm digest is per user, not per company.
    public static readonly IReadOnlyList<string> CompanyConfigurable = new[]
    {
        LeaveSubmitted, LeaveDecided, PayslipReady, StaffInvitation, EdiDeadline, ContractEnding, ProbationEnding,
        ProfileChangeRequested, ProfileChangeDecided, ExpenseClaimSubmitted, ExpenseClaimDecided
    };
}

// Only templates a company has switched OFF have a row; no row means on.
public class CompanyNotificationSetting
{
    public Guid CompanyId { get; set; }
    public string Template { get; set; } = string.Empty;
    public bool Enabled { get; set; }
}

// E8: one row per scheduled job. A job runs when it can move LastRunOn forward to today in a
// single conditional UPDATE, so with several API instances exactly one of them runs it.
public class JobLock
{
    public string Name { get; set; } = string.Empty;
    public DateOnly? LastRunOn { get; set; }
    public DateTime? LastRunAt { get; set; }
}
