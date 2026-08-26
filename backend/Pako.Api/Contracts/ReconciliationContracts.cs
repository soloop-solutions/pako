namespace Pako.Api.Contracts;

public record CreateReconciliationRequest(Guid? InvoiceId, Guid? BillId, Guid JournalEntryLineId, decimal Amount);

public record ReconciliationResponse(Guid Id, Guid? InvoiceId, Guid? BillId, Guid JournalEntryLineId, decimal Amount, DateTime ReconciledAt);

public record DocumentBalanceResponse(decimal Total, decimal Reconciled, decimal Outstanding);
