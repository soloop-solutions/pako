namespace Pako.Domain.Tax;

public record TaxPostingLine(Guid AccountId, decimal Amount, string? Tag);

public record TaxComputationResult(decimal NetAmount, decimal TaxAmount, decimal TotalAmount, IReadOnlyList<TaxPostingLine> PostingLines);

public interface ITaxComputationService
{
    TaxComputationResult Compute(decimal netAmount, TaxDefinition taxDefinition);

    // Invoicing/Bills line entry is gross (brutto) — the amount the user types is the total,
    // VAT included, matching how Kosovo SMEs actually work with prices. Guarantees
    // NetAmount + TaxAmount == grossAmount exactly (no independent per-line rounding drift),
    // since the receivable/payable line has to equal what was typed to the cent.
    TaxComputationResult ComputeFromGross(decimal grossAmount, TaxDefinition taxDefinition);
}
