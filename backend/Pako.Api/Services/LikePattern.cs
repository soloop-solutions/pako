namespace Pako.Api.Services;

public static class LikePattern
{
    public const string EscapeChar = "\\";

    public static string Escape(string term) =>
        term.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");

    public static string Contains(string term) => $"%{Escape(term.Trim())}%";
}
