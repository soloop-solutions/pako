namespace Pako.Domain.Reporting;

public record AgingMatrixInput(Guid PartnerId, string PartnerName, string Bucket, decimal Outstanding);

public record AgingMatrixRow(Guid PartnerId, string PartnerName, List<decimal> BucketAmounts, decimal Total);

public record AgingMatrix(List<AgingMatrixRow> Rows, List<decimal> BucketTotals, decimal GrandTotal);

public static class PayablesAgingMatrix
{
    public static AgingMatrix Build(IEnumerable<AgingMatrixInput> lines, IReadOnlyList<string> bucketOrder)
    {
        var rows = lines
            .GroupBy(l => l.PartnerId)
            .Select(g =>
            {
                var amounts = bucketOrder.Select(b => g.Where(l => l.Bucket == b).Sum(l => l.Outstanding)).ToList();
                return new AgingMatrixRow(g.Key, g.First().PartnerName, amounts, amounts.Sum());
            })
            .OrderBy(r => r.PartnerName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(r => r.PartnerId)
            .ToList();

        var bucketTotals = bucketOrder.Select((_, i) => rows.Sum(r => r.BucketAmounts[i])).ToList();
        return new AgingMatrix(rows, bucketTotals, rows.Sum(r => r.Total));
    }
}
