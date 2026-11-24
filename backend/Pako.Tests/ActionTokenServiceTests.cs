using Pako.Api.Services;
using Xunit;

namespace Pako.Tests;

// User decision 2026-11-24: the journal entry password is asked once per session.
public class ActionTokenServiceTests
{
    private static readonly Guid User = Guid.NewGuid();
    private static readonly Guid Company = Guid.NewGuid();

    [Fact]
    public void OneOffToken_IsUsedUpByTheFirstUse()
    {
        var service = new ActionTokenService();
        var (token, _) = service.GenerateToken(User, Company, "create-journal-entry");

        Assert.True(service.ValidateAndConsume(token, User, Company, "create-journal-entry"));
        Assert.False(service.ValidateAndConsume(token, User, Company, "create-journal-entry"));
    }

    [Fact]
    public void SessionToken_IsReusable_ButOnlyForItsUserCompanyAndAction()
    {
        var service = new ActionTokenService();
        var (token, expiresAt) = service.GenerateToken(User, Company, "create-journal-entry", forSession: true);

        Assert.True(expiresAt > DateTime.UtcNow.AddHours(7));
        Assert.True(service.ValidateAndConsume(token, User, Company, "create-journal-entry"));
        Assert.True(service.ValidateAndConsume(token, User, Company, "create-journal-entry"));
        Assert.False(service.ValidateAndConsume(token, Guid.NewGuid(), Company, "create-journal-entry"));
        Assert.False(service.ValidateAndConsume(token, User, Guid.NewGuid(), "create-journal-entry"));
        Assert.False(service.ValidateAndConsume(token, User, Company, "delete-company"));
    }
}
