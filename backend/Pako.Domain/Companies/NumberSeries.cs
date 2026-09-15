namespace Pako.Domain.Companies;

// S0.3 (Sprint 0 registers, additive/inert). DocumentType is a plain string, not an int tied to
// either Pako.Domain.Invoicing.DocumentType or Pako.Domain.Bills.DocumentType (two different C#
// enums) — this table has to describe document kinds from both, plus future kinds (e.g.
// Proforma), so a string is the least-opinionated inert choice.
//
// B5: this row is configuration only — Pattern — never a counter. The next number is derived
// fresh each time from the highest existing number matching the pattern (NumberSeriesService),
// not read-and-incremented from a stored value: a stored counter drifts from reality after a
// manual override (NumberSeriesController.OverrideInvoiceNumber) or a discarded-and-reissued
// draft, where max(existing) cannot. The row still exists (rather than deriving the pattern from
// a constant) so a company can customise its pattern per document type/year via
// NumberSeriesController.UpdatePattern, and so NumberSeriesService still has a row to take a
// FOR UPDATE lock on for the same per-series serialization the old counter design relied on —
// nothing about the row's own content needs to change for that lock to do its job.
public class NumberSeries
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string DocumentType { get; set; } = string.Empty;
    public int Year { get; set; }
    public string Pattern { get; set; } = string.Empty;
}
