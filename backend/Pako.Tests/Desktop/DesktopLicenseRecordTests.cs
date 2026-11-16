using Pako.Domain.Desktop;

namespace Pako.Tests.Desktop;

public class DesktopLicenseRecordTests
{
    private static readonly DateTimeOffset T0 = new(2026, 11, 1, 9, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Start_SetsTrialStartAndLastSeenToNow()
    {
        var record = DesktopLicenseRecord.Start(T0);

        Assert.Equal(T0, record.TrialStartedAt);
        Assert.Equal(T0, record.LastSeenAt);
        Assert.NotEqual(Guid.Empty, record.Id);
    }

    [Fact]
    public void Touch_AdvancesLastSeenForward()
    {
        var record = DesktopLicenseRecord.Start(T0);

        Assert.True(record.Touch(T0.AddHours(2)));
        Assert.Equal(T0.AddHours(2), record.LastSeenAt);
    }

    [Fact]
    public void Touch_NeverMovesLastSeenBackward()
    {
        var record = DesktopLicenseRecord.Start(T0);
        record.Touch(T0.AddDays(5));

        Assert.False(record.Touch(T0.AddDays(1)));
        Assert.Equal(T0.AddDays(5), record.LastSeenAt);
    }
}
