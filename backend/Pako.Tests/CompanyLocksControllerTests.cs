using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Domain.Companies;
using Pako.Domain.Ledger;
using Pako.Infrastructure;

namespace Pako.Tests;

// IAsyncLifetime: xUnit creates a fresh instance of this class per [Fact] and calls DisposeAsync
// after it finishes, which is what actually closes each test's dedicated Postgres connection —
// without it, connections pile up across the run and Postgres refuses new ones past max_connections.
public class CompanyLocksControllerTests : IAsyncLifetime
{
    private readonly List<PakoDbContext> _dbContexts = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var db in _dbContexts) await db.DisposeAsync();
    }

    private async Task<PakoDbContext> NewContextAsync()
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _dbContexts.Add(db);
        return db;
    }

    private static CompanyLocksController NewController(PakoDbContext db, Guid? userId = null)
    {
        var user = new ClaimsPrincipal(new ClaimsIdentity(
            new[] { new Claim(ClaimTypes.NameIdentifier, (userId ?? Guid.NewGuid()).ToString()) }, "TestAuth"));

        return new CompanyLocksController(db, new NullStringLocalizer<ErrorMessages>())
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = user } }
        };
    }

    private async Task<(PakoDbContext Db, Guid CompanyId)> SeedCompanyAsync()
    {
        var db = await NewContextAsync();
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        db.Companies.Add(company);
        await db.SaveChangesAsync();
        return (db, company.Id);
    }

    [Fact]
    public async Task SetSoftLock_SetsAccountingLockDate()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);

        var result = await controller.SetSoftLock(companyId, new SetSoftLockRequest(LockDateField.AccountingLockDate, new DateOnly(2026, 8, 31)));

        var response = Assert.IsType<CompanyResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(new DateOnly(2026, 8, 31), response.AccountingLockDate);
    }

    [Fact]
    public async Task SetSoftLock_CanClearBackToNull()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);
        await controller.SetSoftLock(companyId, new SetSoftLockRequest(LockDateField.SaleLockDate, new DateOnly(2026, 8, 31)));

        var result = await controller.SetSoftLock(companyId, new SetSoftLockRequest(LockDateField.SaleLockDate, null));

        var response = Assert.IsType<CompanyResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Null(response.SaleLockDate);
    }

    [Fact]
    public async Task SetHardLock_FirstTime_Succeeds()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);

        var result = await controller.SetHardLock(companyId, new SetHardLockRequest(new DateOnly(2026, 6, 30)));

        var response = Assert.IsType<CompanyResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(new DateOnly(2026, 6, 30), response.HardLockDate);
    }

    [Fact]
    public async Task SetHardLock_MovingForward_Succeeds()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);
        await controller.SetHardLock(companyId, new SetHardLockRequest(new DateOnly(2026, 6, 30)));

        var result = await controller.SetHardLock(companyId, new SetHardLockRequest(new DateOnly(2026, 7, 31)));

        var response = Assert.IsType<CompanyResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(new DateOnly(2026, 7, 31), response.HardLockDate);
    }

    // B4: the hard lock cannot move backwards once set.
    [Fact]
    public async Task SetHardLock_MovingBackwards_Rejected()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);
        await controller.SetHardLock(companyId, new SetHardLockRequest(new DateOnly(2026, 6, 30)));

        var result = await controller.SetHardLock(companyId, new SetHardLockRequest(new DateOnly(2026, 5, 31)));

        Assert.IsType<BadRequestObjectResult>(result.Result);
        var reloaded = await db.Companies.FindAsync(companyId);
        Assert.Equal(new DateOnly(2026, 6, 30), reloaded!.HardLockDate);
    }

    // B4: setting the hard lock requires that no Draft journal entry remains on or before the
    // requested date.
    [Fact]
    public async Task SetHardLock_WithDraftEntryInPeriod_Rejected()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var journal = new Journal { Id = Guid.NewGuid(), CompanyId = companyId, Type = JournalType.General, Code = "GEN", Name = "General" };
        var draft = new JournalEntry { Id = Guid.NewGuid(), CompanyId = companyId, JournalId = journal.Id, Date = new DateOnly(2026, 6, 15) };
        db.Journals.Add(journal);
        db.JournalEntries.Add(draft);
        await db.SaveChangesAsync();
        var controller = NewController(db);

        var result = await controller.SetHardLock(companyId, new SetHardLockRequest(new DateOnly(2026, 6, 30)));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task SetHardLock_WithDraftEntryAfterPeriod_Succeeds()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var journal = new Journal { Id = Guid.NewGuid(), CompanyId = companyId, Type = JournalType.General, Code = "GEN", Name = "General" };
        var draft = new JournalEntry { Id = Guid.NewGuid(), CompanyId = companyId, JournalId = journal.Id, Date = new DateOnly(2026, 7, 15) };
        db.Journals.Add(journal);
        db.JournalEntries.Add(draft);
        await db.SaveChangesAsync();
        var controller = NewController(db);

        var result = await controller.SetHardLock(companyId, new SetHardLockRequest(new DateOnly(2026, 6, 30)));

        Assert.IsType<OkObjectResult>(result.Result);
    }

    [Fact]
    public async Task GrantException_Succeeds_AndAppearsInList()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);
        var targetUserId = Guid.NewGuid();

        var result = await controller.GrantException(companyId, new GrantLockExceptionRequest(
            targetUserId, LockDateField.AccountingLockDate, new DateOnly(2026, 8, 1), "Fixing August close", DateTime.UtcNow.AddDays(1)));

        var created = Assert.IsType<AccountLockExceptionResponse>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.True(created.IsLive);

        var listResult = await controller.ListExceptions(companyId);
        var list = Assert.IsType<List<AccountLockExceptionResponse>>(Assert.IsType<OkObjectResult>(listResult.Result).Value);
        Assert.Contains(list, e => e.Id == created.Id);
    }

    [Fact]
    public async Task GrantException_BlankReason_Rejected()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);

        var result = await controller.GrantException(companyId, new GrantLockExceptionRequest(
            Guid.NewGuid(), LockDateField.AccountingLockDate, new DateOnly(2026, 8, 1), "  ", DateTime.UtcNow.AddDays(1)));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task GrantException_PastEndsAt_Rejected()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);

        var result = await controller.GrantException(companyId, new GrantLockExceptionRequest(
            Guid.NewGuid(), LockDateField.AccountingLockDate, new DateOnly(2026, 8, 1), "Fixing August close", DateTime.UtcNow.AddDays(-1)));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task RevokeException_SetsRevokedAtAndIsLiveFalse()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);
        var grantResult = await controller.GrantException(companyId, new GrantLockExceptionRequest(
            Guid.NewGuid(), LockDateField.AccountingLockDate, new DateOnly(2026, 8, 1), "Fixing August close", DateTime.UtcNow.AddDays(1)));
        var created = Assert.IsType<AccountLockExceptionResponse>(Assert.IsType<ObjectResult>(grantResult.Result).Value);

        var revokeResult = await controller.RevokeException(companyId, created.Id);

        var revoked = Assert.IsType<AccountLockExceptionResponse>(Assert.IsType<OkObjectResult>(revokeResult.Result).Value);
        Assert.NotNull(revoked.RevokedAt);
        Assert.False(revoked.IsLive);
    }

    [Fact]
    public async Task RevokeException_AlreadyRevoked_Rejected()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);
        var grantResult = await controller.GrantException(companyId, new GrantLockExceptionRequest(
            Guid.NewGuid(), LockDateField.AccountingLockDate, new DateOnly(2026, 8, 1), "Fixing August close", DateTime.UtcNow.AddDays(1)));
        var created = Assert.IsType<AccountLockExceptionResponse>(Assert.IsType<ObjectResult>(grantResult.Result).Value);
        await controller.RevokeException(companyId, created.Id);

        var result = await controller.RevokeException(companyId, created.Id);

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }
}
