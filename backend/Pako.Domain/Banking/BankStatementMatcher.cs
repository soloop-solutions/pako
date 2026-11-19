namespace Pako.Domain.Banking;

public enum OpenDocumentKind
{
    Invoice,
    Bill,
}

// A posted customer invoice or supplier bill with money still open on it.
public record OpenDocument(OpenDocumentKind Kind, Guid Id, string Number, Guid PartnerId, DateOnly IssueDate, decimal Outstanding);

public record PartnerKey(Guid Id, string Name, string? TaxNumber, string? FiscalNumber);

public record StatementLineInput(bool Incoming, decimal Amount, string? Reference, string? PartnerText);

public enum MatchStatus
{
    // A document was found: by its number in the reference, or the only open document of the partner
    // with exactly this amount.
    Matched,

    // The partner is known and has open documents; the user picks which one.
    Choose,

    // Nothing found.
    None,
}

public record MatchSuggestion(MatchStatus Status, Guid? PartnerId, OpenDocument? Document, decimal Amount);

// Suggests, for each bank statement line, the invoice (money in) or bill (money out) it pays. Pure:
// the caller loads the partners and the open documents. Lines are matched in file order and share the
// open amounts, so two lines paying the same invoice never apply more than it has open.
public static class BankStatementMatcher
{
    // Below this length a document number is too generic ("1", "12") to be found inside a longer text.
    private const int MinNumberLengthForContains = 3;

    public static IReadOnlyList<MatchSuggestion> Suggest(
        IReadOnlyList<StatementLineInput> lines, IReadOnlyList<OpenDocument> documents, IReadOnlyList<PartnerKey> partners)
    {
        var remaining = documents.ToDictionary(d => (d.Kind, d.Id), d => d.Outstanding);
        var result = new List<MatchSuggestion>(lines.Count);

        foreach (var line in lines)
        {
            var kind = line.Incoming ? OpenDocumentKind.Invoice : OpenDocumentKind.Bill;
            var open = documents.Where(d => d.Kind == kind && remaining[(d.Kind, d.Id)] > 0).ToList();

            var partner = ResolvePartner(line.PartnerText, partners);
            var byReference = FindByReference(line.Reference, open);
            if (byReference is not null)
            {
                result.Add(Take(byReference));
                continue;
            }

            if (partner is not null)
            {
                var partnerDocs = open.Where(d => d.PartnerId == partner.Id).ToList();
                var exact = partnerDocs.Where(d => remaining[(d.Kind, d.Id)] == line.Amount).ToList();
                if (exact.Count == 1)
                {
                    result.Add(Take(exact[0]));
                    continue;
                }

                result.Add(new MatchSuggestion(partnerDocs.Count > 0 ? MatchStatus.Choose : MatchStatus.None, partner.Id, null, 0m));
                continue;
            }

            result.Add(new MatchSuggestion(MatchStatus.None, null, null, 0m));

            MatchSuggestion Take(OpenDocument document)
            {
                var key = (document.Kind, document.Id);
                var amount = Math.Min(line.Amount, remaining[key]);
                remaining[key] -= amount;
                return new MatchSuggestion(MatchStatus.Matched, document.PartnerId, document, amount);
            }
        }

        return result;
    }

    // The document whose number is the reference, or (for numbers long enough) appears in it as a
    // whole word: "Pagesa fat. 01/2026" finds 01/2026. Ambiguous hits match nothing.
    public static OpenDocument? FindByReference(string? reference, IReadOnlyList<OpenDocument> documents)
    {
        var text = Normalize(reference);
        if (text.Length == 0) return null;

        var exact = documents.Where(d => Normalize(d.Number) == text).ToList();
        if (exact.Count > 0) return exact.Count == 1 ? exact[0] : null;

        var contained = documents
            .Where(d => Normalize(d.Number) is { Length: >= MinNumberLengthForContains } number && ContainsWord(text, number))
            .ToList();
        return contained.Count == 1 ? contained[0] : null;
    }

    // Fiscal or VAT number first, then the exact name, then the only partner whose name contains the text.
    public static PartnerKey? ResolvePartner(string? text, IReadOnlyList<PartnerKey> partners)
    {
        var value = Normalize(text);
        if (value.Length == 0) return null;

        var byNumber = partners
            .Where(p => Normalize(p.TaxNumber) == value || Normalize(p.FiscalNumber) == value)
            .ToList();
        if (byNumber.Count == 1) return byNumber[0];

        var byName = partners.Where(p => Normalize(p.Name) == value).ToList();
        if (byName.Count == 1) return byName[0];
        if (byName.Count > 1) return null;

        var containing = value.Length >= MinNumberLengthForContains
            ? partners.Where(p => Normalize(p.Name).Contains(value, StringComparison.Ordinal)).ToList()
            : [];
        return containing.Count == 1 ? containing[0] : null;
    }

    private static string Normalize(string? value) =>
        string.Join(' ', (value ?? string.Empty).Trim().ToUpperInvariant()
            .Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));

    private static bool ContainsWord(string text, string word)
    {
        var start = 0;
        while ((start = text.IndexOf(word, start, StringComparison.Ordinal)) >= 0)
        {
            var end = start + word.Length;
            var before = start == 0 || !char.IsLetterOrDigit(text[start - 1]);
            var after = end == text.Length || !char.IsLetterOrDigit(text[end]);
            if (before && after) return true;
            start++;
        }

        return false;
    }
}
