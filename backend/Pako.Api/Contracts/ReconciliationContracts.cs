namespace Pako.Api.Contracts;

public record CreateReconciliationRequest(Guid? InvoiceId, Guid? BillId, Guid JournalEntryLineId, decimal Amount);

public record ReconciliationResponse(Guid Id, Guid? InvoiceId, Guid? BillId, Guid JournalEntryLineId, decimal Amount, DateTime ReconciledAt);

public record DocumentBalanceResponse(decimal Total, decimal Reconciled, decimal Outstanding);

public record RecordPaymentRequest(decimal Amount, Guid CashOrBankAccountId, DateOnly Date);

public record RecordPaymentResponse(ReconciliationResponse Reconciliation, DocumentBalanceResponse Balance);

public record ApplyCreditNoteRequest(Guid CreditNoteId, decimal Amount);

public record ApplyCreditNoteResponse(ReconciliationResponse Reconciliation, DocumentBalanceResponse Balance);

public record ApplyDownPaymentRequest(Guid DownPaymentInvoiceId, decimal Amount);

public record ApplyDownPaymentResponse(ReconciliationResponse Reconciliation, DocumentBalanceResponse Balance, Guid ReclassificationJournalEntryId, decimal ReclassifiedAmount);
