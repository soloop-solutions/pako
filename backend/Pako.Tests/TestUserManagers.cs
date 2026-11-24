using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using Pako.Infrastructure;
using Pako.Infrastructure.Identity;

namespace Pako.Tests;

// A real UserManager over a test database (Identity's EF stores), for tests that create logins.
internal static class TestUserManagers
{
    public static UserManager<AppUser> For(PakoDbContext db)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(db);
        services.AddIdentityCore<AppUser>().AddEntityFrameworkStores<PakoDbContext>();
        return services.BuildServiceProvider().GetRequiredService<UserManager<AppUser>>();
    }
}
