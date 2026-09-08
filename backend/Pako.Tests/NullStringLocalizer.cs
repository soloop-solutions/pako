using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Localization;

namespace Pako.Tests;

// Backed by a real ResourceManagerStringLocalizer resolving Pako.Api's actual Resources/*.resx
// files (built via a minimal DI container, same "prefer a real DI-built dependency over a
// hand-rolled fake" pattern as NewUserManager() in FirmsAndMembershipTests.cs) rather than
// echoing the raw resource key back. Controller tests assert on real user-facing English text,
// matching what the production IStringLocalizer<T> registered in Program.cs actually returns.
internal class NullStringLocalizer<T> : IStringLocalizer<T>
{
    private static readonly IStringLocalizer<T> Inner = BuildLocalizer();

    private static IStringLocalizer<T> BuildLocalizer()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddLocalization(options => options.ResourcesPath = "Resources");
        return services.BuildServiceProvider().GetRequiredService<IStringLocalizer<T>>();
    }

    public LocalizedString this[string name] => Inner[name];
    public LocalizedString this[string name, params object[] arguments] => Inner[name, arguments];
    public IEnumerable<LocalizedString> GetAllStrings(bool includeParentCultures) => Inner.GetAllStrings(includeParentCultures);
}
