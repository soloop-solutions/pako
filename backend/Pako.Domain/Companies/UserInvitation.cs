using System.Security.Cryptography;
using System.Text;

namespace Pako.Domain.Companies;

// docs/USER_ACCESS_PLAN.md: how a company admin gives someone access. The link carries a random
// token; only its SHA-256 hash is stored. Single use, expires after ExpiryDays.
public class UserInvitation
{
    public const int ExpiryDays = 7;

    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string Email { get; set; } = string.Empty;
    public string? FullName { get; set; }
    public string TokenHash { get; set; } = string.Empty;

    // ClientAdmin (Administrator) or ClientStaff with CompanyRoleId.
    public MembershipRole Role { get; set; } = MembershipRole.ClientStaff;
    public Guid? CompanyRoleId { get; set; }
    public Guid? EmployeeId { get; set; }

    public Guid InvitedByUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime ExpiresAt { get; set; }
    public DateTime? AcceptedAt { get; set; }
    public DateTime? RevokedAt { get; set; }

    public bool IsOpen(DateTime now) => AcceptedAt is null && RevokedAt is null && ExpiresAt > now;

    // Returns the raw token (shown once, put in the link) and stores its hash.
    public static (UserInvitation Invitation, string Token) Create(
        Guid companyId, string email, string? fullName, MembershipRole role, Guid? companyRoleId, Guid? employeeId, Guid invitedBy, DateTime now)
    {
        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).Replace('+', '-').Replace('/', '_').TrimEnd('=');
        var invitation = new UserInvitation
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            Email = email.Trim(),
            FullName = string.IsNullOrWhiteSpace(fullName) ? null : fullName.Trim(),
            TokenHash = Hash(token),
            Role = role,
            CompanyRoleId = companyRoleId,
            EmployeeId = employeeId,
            InvitedByUserId = invitedBy,
            CreatedAt = now,
            ExpiresAt = now.AddDays(ExpiryDays)
        };
        return (invitation, token);
    }

    public static string Hash(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
}
