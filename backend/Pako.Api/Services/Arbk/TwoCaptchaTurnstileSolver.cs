using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace Pako.Api.Services.Arbk;

public interface ITurnstileSolver
{
    Task<string> SolveAsync(CancellationToken cancellationToken = default);
}

public sealed class TwoCaptchaTurnstileSolver(HttpClient http, IOptions<ArbkOptions> options) : ITurnstileSolver
{
    private readonly ArbkOptions _options = options.Value;

    public async Task<string> SolveAsync(CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(_options.TwoCaptchaApiKey)) throw new ArbkNotConfiguredException();

        var create = await PostAsync("createTask", new
        {
            clientKey = _options.TwoCaptchaApiKey,
            task = new { type = "TurnstileTaskProxyless", websiteURL = _options.BaseUrl.TrimEnd('/'), websiteKey = _options.SiteKey },
        }, cancellationToken);
        var taskId = create.GetProperty("taskId").Clone();

        for (var i = 0; i < _options.SolveMaxPolls; i++)
        {
            await Task.Delay(TimeSpan.FromSeconds(_options.SolvePollSeconds), cancellationToken);
            var result = await PostAsync("getTaskResult", new { clientKey = _options.TwoCaptchaApiKey, taskId }, cancellationToken);
            if (result.TryGetProperty("status", out var status) && status.GetString() == "ready")
                return result.GetProperty("solution").GetProperty("token").GetString()
                    ?? throw new ArbkUnavailableException("2Captcha returned an empty token.");
        }

        throw new ArbkUnavailableException("2Captcha timed out.");
    }

    private async Task<JsonElement> PostAsync(string path, object body, CancellationToken cancellationToken)
    {
        HttpResponseMessage response;
        try
        {
            response = await http.PostAsJsonAsync(path, body, cancellationToken);
        }
        catch (HttpRequestException ex)
        {
            throw new ArbkUnavailableException("2Captcha is unreachable.", ex);
        }

        using (response)
        {
            var json = await response.Content.ReadFromJsonAsync<JsonElement>(cancellationToken);
            if (json.TryGetProperty("errorId", out var errorId) && errorId.GetInt32() != 0)
            {
                var description = json.TryGetProperty("errorDescription", out var d) ? d.GetString() : null;
                throw new ArbkUnavailableException($"2Captcha: {description}");
            }
            return json;
        }
    }
}
