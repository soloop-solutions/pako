namespace Pako.Api.Services.Arbk;

public class ArbkOptions
{
    public const string Section = "Arbk";

    public string BaseUrl { get; set; } = "https://arbk.rks-gov.net/";
    public string SiteKey { get; set; } = "0x4AAAAAACZtiLmEmN3oaQNR";
    public string AesKey { get; set; } = "8056483646328769";
    public string? TwoCaptchaApiKey { get; set; }
    public string TwoCaptchaBaseUrl { get; set; } = "https://api.2captcha.com/";
    public int CacheHours { get; set; } = 24;
    public int SolvePollSeconds { get; set; } = 5;
    public int SolveMaxPolls { get; set; } = 12;
}
