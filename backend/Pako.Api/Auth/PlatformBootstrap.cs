using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Pako.Infrastructure;
using Pako.Infrastructure.Identity;

namespace Pako.Api.Auth;

// docs/PLATFORM_ADMIN.md "First run": with self-registration gone, a fresh database needs one
// administrator to approve everyone else. On startup, while no platform administrator exists at
// all, the account in Platform:BootstrapAdmin is created (or, if it already exists, promoted —
// its password is never changed). As soon as any administrator exists this does nothing, so it
// runs once per database and can't be used to take over a working installation.
public class PlatformBootstrap
{
    private readonly PakoDbContext _db;
    private readonly UserManager<AppUser> _users;
    private readonly PlatformOptions _options;
    private readonly ILogger<PlatformBootstrap> _logger;

    public PlatformBootstrap(PakoDbContext db, UserManager<AppUser> users, IOptions<PlatformOptions> options, ILogger<PlatformBootstrap> logger)
    {
        _db = db;
        _users = users;
        _options = options.Value;
        _logger = logger;
    }

    public enum Outcome { NotConfigured, AlreadyHasAdministrator, Created, Promoted, Failed }

    public async Task<Outcome> RunAsync()
    {
        var email = _options.BootstrapAdmin.Email?.Trim();
        if (string.IsNullOrEmpty(email)) return Outcome.NotConfigured;
        if (await _db.Users.AnyAsync(u => u.IsPlatformAdmin && !u.IsDisabled)) return Outcome.AlreadyHasAdministrator;

        var user = await _users.FindByEmailAsync(email);
        if (user is not null)
        {
            user.IsPlatformAdmin = true;
            user.IsDisabled = false;
            user.CompanyLimit = null;
            await _users.UpdateAsync(user);
            _logger.LogWarning("No platform administrator existed: promoted {Email} (Platform:BootstrapAdmin).", email);
            return Outcome.Promoted;
        }

        if (string.IsNullOrEmpty(_options.BootstrapAdmin.Password))
        {
            _logger.LogError("Platform:BootstrapAdmin:Email is set but no password: the first administrator was not created.");
            return Outcome.Failed;
        }

        user = new AppUser
        {
            UserName = email,
            Email = email,
            EmailConfirmed = true,
            FullName = "PAKO Administrator",
            IsPlatformAdmin = true,
            CompanyLimit = null,
        };
        var created = await _users.CreateAsync(user, _options.BootstrapAdmin.Password);
        if (!created.Succeeded)
        {
            _logger.LogError("Could not create the first administrator {Email}: {Errors}", email,
                string.Join(" ", created.Errors.Select(e => e.Description)));
            return Outcome.Failed;
        }

        _logger.LogWarning("No platform administrator existed: created {Email} (Platform:BootstrapAdmin). Change its password after signing in.", email);
        return Outcome.Created;
    }
}
