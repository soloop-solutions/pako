namespace Pako.Api.Contracts;

// Email delivery (docs/EMAIL.md): sending a posted invoice to the customer with its PDF.
// To: empty means the customer's email. Culture: "sq" (default) or "en" — the language of the email
// and of the attached PDF.
public record EmailInvoiceRequest(List<string>? To = null, string? Message = null, string? Culture = null);

// One email of an invoice, as queued in the outbox: Pending until the worker sends it, Sent, or Failed
// with the provider's reason.
public record InvoiceEmailResponse(
    Guid Id, string Recipient, string State, int Attempts, string? LastError, DateTime CreatedAt, DateTime? SentAt);

// "Send test email". To: platform admins may name any address; a company's test goes to the caller.
public record SendTestEmailRequest(string? To = null);

// Sent synchronously, so setup can be checked in one click. Mode: Log / Smtp / Api.
public record TestEmailResponse(string Recipient, bool Sent, string Mode, string? Error);
