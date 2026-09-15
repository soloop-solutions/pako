using Pako.Domain.Companies;

namespace Pako.Tests;

public class AccountLockResolverTests
{
    private static Company NewCompany() => new()
    {
        Id = Guid.NewGuid(),
        Name = "Test Co",
        AccountingLockDate = new DateOnly(2026, 8, 31),
        TaxLockDate = new DateOnly(2026, 8, 31),
        SaleLockDate = new DateOnly(2026, 8, 31),
        PurchaseLockDate = new DateOnly(2026, 8, 31),
        HardLockDate = new DateOnly(2026, 1, 31)
    };

    [Fact]
    public void ApplyEffectiveLocks_NoExceptions_ReturnsCompanysOwnDates()
    {
        var company = NewCompany();

        var effective = AccountLockResolver.ApplyEffectiveLocks(company, Guid.NewGuid(), Array.Empty<AccountLockException>());

        Assert.Equal(company.AccountingLockDate, effective.AccountingLockDate);
        Assert.Equal(company.TaxLockDate, effective.TaxLockDate);
        Assert.Equal(company.SaleLockDate, effective.SaleLockDate);
        Assert.Equal(company.PurchaseLockDate, effective.PurchaseLockDate);
    }

    [Fact]
    public void ApplyEffectiveLocks_LiveExceptionForOneField_OverridesOnlyThatField()
    {
        var company = NewCompany();
        var userId = Guid.NewGuid();
        var exception = new AccountLockException
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            UserId = userId,
            LockDateField = LockDateField.AccountingLockDate,
            LockDate = new DateOnly(2026, 8, 1),
            Reason = "Fixing August close",
            EndsAt = DateTime.UtcNow.AddDays(1)
        };

        var effective = AccountLockResolver.ApplyEffectiveLocks(company, userId, new[] { exception });

        Assert.Equal(new DateOnly(2026, 8, 1), effective.AccountingLockDate);
        Assert.Equal(company.TaxLockDate, effective.TaxLockDate);
        Assert.Equal(company.SaleLockDate, effective.SaleLockDate);
        Assert.Equal(company.PurchaseLockDate, effective.PurchaseLockDate);
    }

    [Fact]
    public void ApplyEffectiveLocks_ExceptionForDifferentUser_DoesNotApply()
    {
        var company = NewCompany();
        var exception = new AccountLockException
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            UserId = Guid.NewGuid(),
            LockDateField = LockDateField.AccountingLockDate,
            LockDate = new DateOnly(2026, 8, 1),
            Reason = "Fixing August close",
            EndsAt = DateTime.UtcNow.AddDays(1)
        };

        var effective = AccountLockResolver.ApplyEffectiveLocks(company, Guid.NewGuid(), new[] { exception });

        Assert.Equal(company.AccountingLockDate, effective.AccountingLockDate);
    }

    // HardLockDate has no exception path at all — ApplyEffectiveLocks never touches it, by
    // construction (LockDateField has no Hard variant to match against).
    [Fact]
    public void ApplyEffectiveLocks_HardLockDate_AlwaysPassedThroughUnchanged()
    {
        var company = NewCompany();

        var effective = AccountLockResolver.ApplyEffectiveLocks(company, Guid.NewGuid(), Array.Empty<AccountLockException>());

        Assert.Equal(company.HardLockDate, effective.HardLockDate);
    }

    [Fact]
    public void IsLive_RevokedException_IsNotLive()
    {
        var exception = new AccountLockException
        {
            Id = Guid.NewGuid(),
            EndsAt = DateTime.UtcNow.AddDays(1),
            RevokedAt = DateTime.UtcNow
        };

        Assert.False(exception.IsLive(DateTime.UtcNow));
    }

    [Fact]
    public void IsLive_ExpiredException_IsNotLive()
    {
        var exception = new AccountLockException
        {
            Id = Guid.NewGuid(),
            EndsAt = DateTime.UtcNow.AddDays(-1)
        };

        Assert.False(exception.IsLive(DateTime.UtcNow));
    }
}
