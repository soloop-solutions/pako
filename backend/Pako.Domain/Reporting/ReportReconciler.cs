namespace Pako.Domain.Reporting;

public record CheckResult(string Key, bool Passed, decimal Expected, decimal Actual);

public static class ReportReconciler
{
    public const decimal Tolerance = 0.01m;

    public static CheckResult Equal(string key, decimal expected, decimal actual) =>
        new(key, Math.Abs(expected - actual) <= Tolerance, expected, actual);
}
