using Pako.Domain.Companies;

namespace Pako.Api.Contracts;

public record CreatePaymentMethodRequest(string Name, PaymentMethodKind Kind, Guid LedgerAccountId);

public record PaymentMethodResponse(Guid Id, string Name, PaymentMethodKind Kind, Guid LedgerAccountId);
