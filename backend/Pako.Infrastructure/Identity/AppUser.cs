using Microsoft.AspNetCore.Identity;

namespace Pako.Infrastructure.Identity;

public class AppUser : IdentityUser<Guid>
{
    // Shown in the administration dashboard; set from the invitation or by the user.
    public string? FullName { get; set; }
    public DateTime? LastLoginAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Platform administration (docs/PLATFORM_ADMIN.md): runs the admin panel, above every company.
    public bool IsPlatformAdmin { get; set; }
    // A disabled account can't sign in, and its open sessions stop working on the next request.
    public bool IsDisabled { get; set; }
    // How many companies this person may create; null = no limit. New accounts start at 0 (staff
    // invited into a company create none) unless an administrator approves them with a limit.
    public int? CompanyLimit { get; set; } = 0;
}
