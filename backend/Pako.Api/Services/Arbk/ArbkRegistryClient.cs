using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using Pako.Api.Contracts;

namespace Pako.Api.Services.Arbk;

public interface IArbkRegistry
{
    Task<IReadOnlyList<ArbkBusinessResponse>> SearchAsync(string? name, string? nui, string? fiscalNumber, CancellationToken cancellationToken = default);

    Task<ArbkBusinessResponse?> GetDetailsAsync(string registrationId, CancellationToken cancellationToken = default);
}

public sealed class ArbkRegistryClient(HttpClient http, ITurnstileSolver solver, IMemoryCache cache, IOptions<ArbkOptions> options) : IArbkRegistry
{
    private const string Api = "api/api/Services/";
    private readonly ArbkOptions _options = options.Value;

    public async Task<IReadOnlyList<ArbkBusinessResponse>> SearchAsync(string? name, string? nui, string? fiscalNumber, CancellationToken cancellationToken = default)
    {
        name = name?.Trim() ?? "";
        nui = nui?.Trim() ?? "";
        fiscalNumber = fiscalNumber?.Trim() ?? "";
        var cacheKey = $"arbk:search:{name.ToLowerInvariant()}|{nui}|{fiscalNumber}";
        if (cache.TryGetValue(cacheKey, out IReadOnlyList<ArbkBusinessResponse>? hit) && hit is not null) return hit;

        var token = await solver.SolveAsync(cancellationToken);
        using var request = new HttpRequestMessage(HttpMethod.Post, Api + "KerkoBiznesin")
        {
            Content = new StringContent(JsonSerializer.Serialize(new
            {
                emriBiznesit = name,
                nui,
                nrFiscal = fiscalNumber,
                numriPersonal = "",
                aktivitetiKryesorId = "",
                aktivitetetTjeraId = "",
                gjuhaId = "1",
                token,
            }), Encoding.UTF8, "application/json"),
        };
        request.Headers.Add("key", await AuthKeyAsync(cancellationToken));

        var root = await SendAsync(request, cancellationToken);
        var items = root.ValueKind == JsonValueKind.Array ? root
            : Find(root, "searchAll") is { ValueKind: JsonValueKind.Array } all ? all
            : Find(root, "data") is { ValueKind: JsonValueKind.Array } data ? data
            : default;

        IReadOnlyList<ArbkBusinessResponse> result = items.ValueKind == JsonValueKind.Array
            ? items.EnumerateArray().Select(Map).ToList()
            : [];
        cache.Set(cacheKey, result, TimeSpan.FromHours(_options.CacheHours));
        return result;
    }

    public async Task<ArbkBusinessResponse?> GetDetailsAsync(string registrationId, CancellationToken cancellationToken = default)
    {
        registrationId = registrationId.Trim();
        var cacheKey = $"arbk:details:{registrationId}";
        if (cache.TryGetValue(cacheKey, out ArbkBusinessResponse? hit) && hit is not null) return hit;

        var token = await solver.SolveAsync(cancellationToken);
        using var request = new HttpRequestMessage(HttpMethod.Get,
            $"{Api}TeDhenatBiznesit?nRegjistriId={Uri.EscapeDataString(registrationId)}&Gjuha=1&token={Uri.EscapeDataString(token)}");
        request.Headers.Add("key", await AuthKeyAsync(cancellationToken));

        var root = await SendAsync(request, cancellationToken);
        if (root.ValueKind == JsonValueKind.Array) root = root.GetArrayLength() > 0 ? root[0] : default;
        if (root.ValueKind != JsonValueKind.Object) return null;

        var result = Map(root);
        cache.Set(cacheKey, result, TimeSpan.FromHours(_options.CacheHours));
        return result;
    }

    private async Task<string> AuthKeyAsync(CancellationToken cancellationToken)
    {
        string date;
        try
        {
            date = (await http.GetStringAsync("api/api/Home/GetDate", cancellationToken)).Trim('"');
        }
        catch (HttpRequestException ex)
        {
            throw new ArbkUnavailableException("ARBK is unreachable.", ex);
        }

        var keyBytes = Encoding.UTF8.GetBytes(_options.AesKey);
        using var aes = Aes.Create();
        aes.Key = keyBytes;
        aes.IV = keyBytes;
        return Convert.ToBase64String(aes.EncryptCbc(Encoding.UTF8.GetBytes(date), keyBytes));
    }

    private async Task<JsonElement> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        try
        {
            using var response = await http.SendAsync(request, cancellationToken);
            if (!response.IsSuccessStatusCode) throw new ArbkUnavailableException($"ARBK responded {(int)response.StatusCode}.");
            using var doc = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(cancellationToken), cancellationToken: cancellationToken);
            return doc.RootElement.Clone();
        }
        catch (HttpRequestException ex)
        {
            throw new ArbkUnavailableException("ARBK is unreachable.", ex);
        }
        catch (JsonException ex)
        {
            throw new ArbkUnavailableException("ARBK returned an unreadable response.", ex);
        }
    }

    private static ArbkBusinessResponse Map(JsonElement item)
    {
        var b = Find(item, "teDhenatBiznesit") is { ValueKind: JsonValueKind.Object } wrapped ? wrapped
            : Find(item, "table") is { ValueKind: JsonValueKind.Object } table ? table
            : item;

        return new ArbkBusinessResponse(
            Text(b, "nRegjistriID", "NRegjistriId"),
            Text(b, "EmriBiznesit"),
            Text(b, "EmriTregtar"),
            Text(b, "NUI", "NumriBiznesit"),
            Text(b, "NumriFiskal"),
            Text(b, "Komuna"),
            Text(b, "Adresa"),
            Text(b, "LlojiBiznesit"),
            Text(b, "StatusiARBK"),
            Text(b, "DataRegjistrimit"),
            Text(b, "Telefoni"),
            Text(b, "Email"),
            Text(b, "WebFaqja"),
            Text(b, "Kapitali"),
            Text(b, "NumriPunetoreve"));
    }

    private static JsonElement Find(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object) return default;
        foreach (var property in obj.EnumerateObject())
            if (property.Name.Equals(name, StringComparison.OrdinalIgnoreCase)) return property.Value;
        return default;
    }

    private static string? Text(JsonElement obj, params string[] names)
    {
        foreach (var name in names)
        {
            var value = Find(obj, name);
            var text = value.ValueKind switch
            {
                JsonValueKind.String => value.GetString(),
                JsonValueKind.Number => value.GetRawText(),
                _ => null,
            };
            if (!string.IsNullOrWhiteSpace(text)) return text.Trim();
        }
        return null;
    }
}
