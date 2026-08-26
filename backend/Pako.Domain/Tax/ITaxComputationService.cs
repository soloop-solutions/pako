namespace Pako.Domain.Tax;

public record TaxPostingLine(Guid AccountId, decimal Amount, string? Tag);

public record TaxComputationResult(decimal NetAmount, decimal TaxAmount, decimal TotalAmount, IReadOnlyList<TaxPostingLine> PostingLines);

public interface ITaxComputationService
{
    TaxComputationResult Compute(decimal netAmount, TaxDefinition taxDefinition);
}
