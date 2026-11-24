using System.Net;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using Pako.Api;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Api.Services.Arbk;

namespace Pako.Tests;

public class ArbkRegistryTests
{
    private const string SearchJson = """
        [{"nRegjistriID":123,"EmriBiznesit":"SOLOOP SH.P.K.","NUI":"811234567","NumriFiskal":"601234567","Komuna":"Prishtinë","Adresa":"Rr. Nëna Terezë","LlojiBiznesit":"SHPK","StatusiARBK":"Aktiv","DataRegjistrimit":"2020-01-15"}]
        """;

    private sealed class StubHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public List<HttpRequestMessage> Requests { get; } = [];
        public List<string> Bodies { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Requests.Add(request);
            Bodies.Add(request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancellationToken));
            return respond(request);
        }
    }

    private sealed class CountingSolver : ITurnstileSolver
    {
        public int Calls { get; private set; }

        public Task<string> SolveAsync(CancellationToken cancellationToken = default)
        {
            Calls++;
            return Task.FromResult("solved-token");
        }
    }

    private sealed class ThrowingSolver(Exception exception) : ITurnstileSolver
    {
        public Task<string> SolveAsync(CancellationToken cancellationToken = default) => throw exception;
    }

    private static HttpResponseMessage Json(string body) =>
        new(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") };

    private static HttpResponseMessage Arbk(HttpRequestMessage request) =>
        request.RequestUri!.AbsolutePath.EndsWith("Home/GetDate") ? Json("\"2026-11-24 10:00:00\"") : Json(SearchJson);

    private static ArbkRegistryClient NewClient(StubHandler handler, ITurnstileSolver solver) =>
        new(new HttpClient(handler) { BaseAddress = new Uri("https://arbk.test/") }, solver,
            new MemoryCache(new MemoryCacheOptions()), Options.Create(new ArbkOptions()));

    [Fact]
    public async Task Search_MapsRegistryFieldsAndSendsNuiAndToken()
    {
        var handler = new StubHandler(Arbk);
        var client = NewClient(handler, new CountingSolver());

        var result = await client.SearchAsync(null, "811234567", null);

        var business = Assert.Single(result);
        Assert.Equal("123", business.RegistrationId);
        Assert.Equal("SOLOOP SH.P.K.", business.BusinessName);
        Assert.Equal("811234567", business.Nui);
        Assert.Equal("601234567", business.FiscalNumber);
        Assert.Equal("Prishtinë", business.Municipality);

        var post = handler.Requests.Single(r => r.Method == HttpMethod.Post);
        Assert.EndsWith("Services/KerkoBiznesin", post.RequestUri!.AbsolutePath);
        var body = handler.Bodies[handler.Requests.IndexOf(post)];
        Assert.Contains("\"nui\":\"811234567\"", body);
        Assert.Contains("\"token\":\"solved-token\"", body);
    }

    [Fact]
    public async Task Search_AuthKeyIsAesOfServerDate()
    {
        var handler = new StubHandler(Arbk);
        await NewClient(handler, new CountingSolver()).SearchAsync(null, "811234567", null);

        var keyBytes = Encoding.UTF8.GetBytes(new ArbkOptions().AesKey);
        using var aes = Aes.Create();
        aes.Key = keyBytes;
        aes.IV = keyBytes;
        var expected = Convert.ToBase64String(aes.EncryptCbc(Encoding.UTF8.GetBytes("2026-11-24 10:00:00"), keyBytes));

        var post = handler.Requests.Single(r => r.Method == HttpMethod.Post);
        Assert.Equal(expected, post.Headers.GetValues("key").Single());
    }

    [Fact]
    public async Task Search_RepeatedQueryIsServedFromCacheWithoutSolvingAgain()
    {
        var solver = new CountingSolver();
        var client = NewClient(new StubHandler(Arbk), solver);

        await client.SearchAsync(null, "811234567", null);
        await client.SearchAsync(null, "811234567", null);

        Assert.Equal(1, solver.Calls);
    }

    [Fact]
    public async Task Details_MapsContactFields()
    {
        var handler = new StubHandler(r => r.RequestUri!.AbsolutePath.EndsWith("Home/GetDate")
            ? Json("\"2026-11-24 10:00:00\"")
            : Json("""{"teDhenatBiznesit":{"nRegjistriID":123,"EmriBiznesit":"SOLOOP SH.P.K.","NUI":"811234567","Telefoni":"+383 44 000 000","Email":"info@soloop.test","Kapitali":"1000"}}"""));

        var business = await NewClient(handler, new CountingSolver()).GetDetailsAsync("123");

        Assert.NotNull(business);
        Assert.Equal("+383 44 000 000", business.Phone);
        Assert.Equal("info@soloop.test", business.Email);
        Assert.Equal("1000", business.Capital);
        Assert.Contains("nRegjistriId=123", handler.Requests.Last().RequestUri!.Query);
    }

    [Fact]
    public async Task Search_ArbkErrorSurfacesAsUnavailable()
    {
        var handler = new StubHandler(r => r.RequestUri!.AbsolutePath.EndsWith("Home/GetDate")
            ? Json("\"2026-11-24\"")
            : new HttpResponseMessage(HttpStatusCode.InternalServerError));

        await Assert.ThrowsAsync<ArbkUnavailableException>(() =>
            NewClient(handler, new CountingSolver()).SearchAsync(null, "811234567", null));
    }

    private sealed class FakeRegistry(Exception? failure = null) : IArbkRegistry
    {
        public Task<IReadOnlyList<ArbkBusinessResponse>> SearchAsync(string? name, string? nui, string? fiscalNumber, CancellationToken cancellationToken = default) =>
            failure is null ? Task.FromResult<IReadOnlyList<ArbkBusinessResponse>>([]) : throw failure;

        public Task<ArbkBusinessResponse?> GetDetailsAsync(string registrationId, CancellationToken cancellationToken = default) =>
            failure is null ? Task.FromResult<ArbkBusinessResponse?>(null) : throw failure;
    }

    private static ArbkController NewController(IArbkRegistry registry) => new(registry, new NullStringLocalizer<ErrorMessages>());

    [Fact]
    public async Task Controller_RefusesSearchWithNoUsableParameter()
    {
        var result = await NewController(new FakeRegistry()).Search(q: "ab");

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Controller_MapsUnconfiguredTo503AndUnavailableTo502()
    {
        var unconfigured = await NewController(new FakeRegistry(new ArbkNotConfiguredException())).Search(nui: "811234567");
        var unavailable = await NewController(new FakeRegistry(new ArbkUnavailableException("down"))).Search(nui: "811234567");

        Assert.Equal(503, Assert.IsType<ObjectResult>(unconfigured.Result).StatusCode);
        Assert.Equal(502, Assert.IsType<ObjectResult>(unavailable.Result).StatusCode);
    }

    [Fact]
    public async Task Controller_DetailsReturns404WhenRegistryHasNothing()
    {
        var result = await NewController(new FakeRegistry()).Details("999");

        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Fact]
    public async Task Solver_WithoutApiKeyIsNotConfigured()
    {
        var solver = new TwoCaptchaTurnstileSolver(new HttpClient(), Options.Create(new ArbkOptions()));

        await Assert.ThrowsAsync<ArbkNotConfiguredException>(() => solver.SolveAsync());
    }
}
