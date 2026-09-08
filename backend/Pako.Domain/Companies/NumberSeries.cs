namespace Pako.Domain.Companies;

// S0.3 (Sprint 0 registers, additive/inert). DocumentType is a plain string, not an int tied to
// either Pako.Domain.Invoicing.DocumentType or Pako.Domain.Bills.DocumentType (two different C#
// enums) — this table has to describe document kinds from both, plus future kinds (e.g.
// Proforma), so a string is the least-opinionated inert choice. Track B1 decides the actual
// encoding when it wires this up to replace Company's Next*Number counters.
public class NumberSeries
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string DocumentType { get; set; } = string.Empty;
    public int Year { get; set; }
    public string Pattern { get; set; } = string.Empty;
    public int NextValue { get; set; } = 1;
}
