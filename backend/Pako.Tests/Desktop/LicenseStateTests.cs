using Pako.Domain.Desktop;

namespace Pako.Tests.Desktop;

public class LicenseStateTests
{
    private const string Machine = "AAAA-BBBB-CCCC-DDDD";
    private static readonly DateTimeOffset Start = new(2026, 11, 1, 0, 0, 0, TimeSpan.Zero);

    private static DesktopLicenseRecord Record(string? key = null, DateTimeOffset? lastSeen = null) => new()
    {
        Id = Guid.NewGuid(),
        TrialStartedAt = Start,
        LastSeenAt = lastSeen ?? Start,
        LicenseKey = key
    };

    [Fact]
    public void Evaluate_TrialCountsDownFromTrialStart()
    {
        var keys = new LicenseTestKeys();

        var state = LicenseState.Evaluate(Record(), Machine, Start.AddDays(4), keys.PublicKey);

        Assert.Equal(LicenseStatus.Trial, state.Status);
        Assert.Equal(10, state.TrialDaysLeft);
        Assert.Equal(Machine, state.MachineCode);
    }

    [Fact]
    public void Evaluate_AfterTrial_NoKey_IsReadOnly()
    {
        var keys = new LicenseTestKeys();

        var state = LicenseState.Evaluate(Record(), Machine, Start.AddDays(15), keys.PublicKey);

        Assert.Equal(LicenseStatus.ReadOnly, state.Status);
        Assert.Equal(0, state.TrialDaysLeft);
    }

    [Fact]
    public void Evaluate_ValidKeyForThisMachine_IsLicensed()
    {
        var keys = new LicenseTestKeys();
        var key = keys.Issue(new LicensePayload(Machine, "Acme", Start, Start.AddYears(1)));

        var state = LicenseState.Evaluate(Record(key), Machine, Start.AddDays(40), keys.PublicKey);

        Assert.Equal(LicenseStatus.Licensed, state.Status);
        Assert.Equal("Acme", state.Customer);
        Assert.Equal(Start.AddYears(1), state.ExpiresAt);
    }

    [Fact]
    public void Evaluate_KeyForOtherMachine_IsReadOnly()
    {
        var keys = new LicenseTestKeys();
        var key = keys.Issue(new LicensePayload("ZZZZ-ZZZZ-ZZZZ-ZZZZ", "Acme", Start, null));

        var state = LicenseState.Evaluate(Record(key), Machine, Start.AddDays(40), keys.PublicKey);

        Assert.Equal(LicenseStatus.ReadOnly, state.Status);
    }

    [Fact]
    public void Evaluate_ExpiredKey_IsReadOnly()
    {
        var keys = new LicenseTestKeys();
        var key = keys.Issue(new LicensePayload(Machine, "Acme", Start, Start.AddDays(30)));

        var state = LicenseState.Evaluate(Record(key), Machine, Start.AddDays(31), keys.PublicKey);

        Assert.Equal(LicenseStatus.ReadOnly, state.Status);
    }

    [Fact]
    public void Evaluate_ClockSetBack_DoesNotExtendTrial()
    {
        var keys = new LicenseTestKeys();
        var record = Record(lastSeen: Start.AddDays(20));

        var state = LicenseState.Evaluate(record, Machine, Start.AddDays(1), keys.PublicKey);

        Assert.Equal(LicenseStatus.ReadOnly, state.Status);
    }

    [Fact]
    public void Evaluate_ClockSetBack_DoesNotReviveExpiredKey()
    {
        var keys = new LicenseTestKeys();
        var key = keys.Issue(new LicensePayload(Machine, "Acme", Start, Start.AddDays(30)));
        var record = Record(key, Start.AddDays(40));

        var state = LicenseState.Evaluate(record, Machine, Start.AddDays(5), keys.PublicKey);

        Assert.Equal(LicenseStatus.ReadOnly, state.Status);
    }
}
