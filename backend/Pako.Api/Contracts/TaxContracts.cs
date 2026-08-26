using Pako.Domain.Tax;

namespace Pako.Api.Contracts;

public record TaxDefinitionResponse(Guid Id, string Name, decimal Rate, TaxType Type, TaxScope Scope, bool IsActive);
